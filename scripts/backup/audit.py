#!/usr/bin/env python3
"""Controllo giornaliero archivio e restore DB trimestrale, solo infrastruttura backup."""
import argparse
import datetime as dt
import gzip
import json
import os
from pathlib import Path
import subprocess
import tempfile
import uuid

import aruba
import backup
import maintenance


def write_state(path, data):
    temporary = path.with_name(path.name + ".new")
    temporary.write_bytes(backup.canonical(data)); temporary.chmod(0o600)
    os.replace(temporary, path)


def quarter(now):
    return f"{now.year}-{(now.month-1)//3+1}"


def latest_manifest(archive, project, work):
    items, token = [], None
    while True:
        params = {"Bucket":archive.bucket, "Prefix":project+"/snapshots/"}
        if token:
            params["ContinuationToken"] = token
        result = archive.s3.list_objects_v2(**params)
        items.extend(o for o in result.get("Contents", []) if o["Key"].endswith("/manifest.json.gz"))
        if not result.get("IsTruncated"):
            break
        token = result["NextContinuationToken"]
    if not items:
        raise backup.BackupError("Nessun checkpoint disponibile")
    key = max(items, key=lambda o:o["LastModified"])["Key"]
    head = archive.head(key)
    archive.download(key, head["VersionId"], work/"manifest.gz")
    manifest = json.loads(gzip.decompress((work/"manifest.gz").read_bytes()))
    maintenance.references(manifest, project, archive.key_id)
    committed = dt.datetime.fromisoformat(manifest["committed_at"])
    age = (archive.now-committed).total_seconds()
    if not 0 <= age <= 3*3600:
        raise backup.BackupError("Checkpoint troppo vecchio o data futura")
    return manifest


def expiry_probe(archive, project, state, path):
    probe = state.get("expiry_probe")
    if probe:
        maintenance.validate_ref(probe["archive"], project, archive.key_id)
        ref = probe["archive"]
        try:
            archive.s3.head_object(Bucket=archive.bucket, Key=ref["key"], VersionId=ref["version_id"])
        except Exception as error:
            if getattr(error, "response", {}).get("Error", {}).get("Code") not in ("404","NoSuchKey","NoSuchVersion","NotFound"):
                raise
            if archive.now-dt.datetime.fromisoformat(probe["created_at"]) < dt.timedelta(days=2):
                raise backup.BackupError("Versione sintetica assente prima della fine del lock")
            state["last_expiry_observed_at"] = archive.now.isoformat()
            state["expiry_probe"] = None
            write_state(path, state)
            return "version_expiration_observed"
        age = archive.now-dt.datetime.fromisoformat(probe["created_at"])
        if age > dt.timedelta(days=7):
            raise backup.BackupError("Versione sintetica non scaduta entro finestra di osservazione")
        return "awaiting_actual_version_expiration"
    with tempfile.TemporaryDirectory(prefix="expiry-probe-") as tmp:
        source = Path(tmp)/"synthetic.bin"
        source.write_bytes(os.urandom(32))
        ref = archive.put(project+"/checks/expiry-"+uuid.uuid4().hex, source, 2)
    state["expiry_probe"] = {"created_at":archive.now.isoformat(), "archive":ref}
    write_state(path, state)
    return "synthetic_probe_created"


def database_drill(archive, manifest, work):
    for label in ("database.dump", "roles.sql"):
        ref = manifest[label]
        meta = archive.download(ref["key"], ref["version_id"], work/label)
        if (backup.digest_file(work/label) != ref["sha256"] or
                (work/label).stat().st_size != ref["bytes"] or meta["cipher-sha256"] != ref["cipher_sha256"]):
            raise backup.BackupError("File restore diverso dal checkpoint")
    was_running = subprocess.run(["systemctl","is-active","--quiet","docker.service"]).returncode == 0
    try:
        if not was_running:
            subprocess.run(["systemctl","start","docker.service"],check=True,timeout=60)
        result = subprocess.run([os.sys.executable,str(Path(__file__).with_name("restore-local.py")),
            "--dump",str(work/"database.dump"),"--roles",str(work/"roles.sql"),"--work",str(work/"restore")],
            stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=1800)
        if result.returncode:
            raise backup.BackupError("Restore DB periodico fallito")
        report = json.loads((work/"restore/result.json").read_text())
        if not report.get("all_copy_values_match") or report.get("network") != "none":
            raise backup.BackupError("Restore DB periodico non verificato")
        return report
    finally:
        if not was_running:
            remaining = subprocess.run(["docker","ps","-q"],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30)
            if remaining.returncode == 0 and not remaining.stdout.strip():
                subprocess.run(["systemctl","stop","docker.service","docker.socket"],check=True,timeout=60)


def run(config, secret, state_dir, force_drill=False):
    state_dir = Path(state_dir)
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    if state_dir.is_symlink() or state_dir.stat().st_mode & 0o077:
        raise backup.BackupError("Directory audit non privata")
    state_path = state_dir/"state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    archive = maintenance.connect(config, secret)
    archive.preflight()
    with tempfile.TemporaryDirectory(prefix="audit-", dir=state_dir) as tmp:
        work = Path(tmp)
        manifest = latest_manifest(archive, config["project_ref"], work)
        expiry = expiry_probe(archive, config["project_ref"], state, state_path)
        performed = force_drill or state.get("last_drill_quarter") != quarter(archive.now)
        if performed:
            state["last_drill"] = database_drill(archive, manifest, work)
            state["last_drill_quarter"] = quarter(archive.now)
            state["last_drill_at"] = archive.now.isoformat()
        state["last_audit_at"] = archive.now.isoformat()
        write_state(state_path,state)
        report = {"status":"backup_audit_verified", "expiry":expiry,
            "database_drill_performed":performed,"last_drill":state.get("last_drill"),
            "last_drill_at":state.get("last_drill_at"),"managed_crm_restore_tested":False}
        write_state(state_dir/"result.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config",default="scripts/backup/aruba-config.json")
    parser.add_argument("--secrets",default=os.path.join(os.environ.get("CREDENTIALS_DIRECTORY",""),"private.json"))
    parser.add_argument("--state-dir",required=True)
    parser.add_argument("--force-drill",action="store_true")
    args = parser.parse_args(); os.umask(0o077)
    secret = aruba.load_secret(args.secrets)
    config = aruba.validate_config(json.loads(Path(args.config).read_text()))
    report = aruba.run_monitored(secret.get("audit_monitor_url"),
        lambda:run(config,secret,args.state_dir,args.force_drill))
    print(json.dumps(report),flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status":"backup_audit_failed","error_type":type(error).__name__}),flush=True)
        raise SystemExit(1)
