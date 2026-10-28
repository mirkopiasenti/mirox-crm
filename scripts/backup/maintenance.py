#!/usr/bin/env python3
"""Esporta e verifica una copia indipendente cifrata; nessuna scrittura CRM."""
import argparse
import datetime as dt
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import tarfile
import tempfile

import aruba
import backup


def connect(config, secret):
    import boto3
    from botocore.config import Config
    a = secret["archive"]
    s3 = boto3.client("s3", endpoint_url=config["endpoint_url"],
        region_name=config["signing_region"], aws_access_key_id=a["access_key"],
        aws_secret_access_key=a["secret_key"],
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
            request_checksum_calculation="when_required", response_checksum_validation="when_required",
            retries={"max_attempts": 5, "mode": "standard"}))
    return aruba.Archive(s3, a["bucket"], dt.datetime.now(backup.UTC), aruba.encryption_key(secret))


def validate_ref(ref, project, key_id):
    key = ref.get("key", "")
    if (not key.startswith(project + "/") or ".." in key or
        not re.fullmatch(r"[a-zA-Z0-9_./-]+", key) or
        not isinstance(ref.get("version_id"), str) or not ref["version_id"] or
        ref.get("encryption") != aruba.ENCRYPTION or ref.get("key_id") != key_id or
        type(ref.get("bytes")) is not int or not 0 <= ref["bytes"] <= backup.MAX_FILE_BYTES or
        not all(re.fullmatch(r"[a-f0-9]{64}", ref.get(k, "")) for k in ("sha256", "cipher_sha256"))):
        raise backup.BackupError("Riferimento indipendente non valido")


def references(manifest, project, key_id):
    if (manifest.get("format") != 1 or manifest.get("status") != "complete" or
            manifest.get("project_ref") != project):
        raise backup.BackupError("Manifest incompleto o progetto errato")
    refs = [r["archive"] for r in manifest["objects"]]
    refs += [manifest[k] for k in ("database.dump", "roles.sql", "recovery.json")]
    if "recovery-source.zip" in manifest:
        refs.append(manifest["recovery-source.zip"])
    refs += [r["archive"] for r in manifest.get("repositories", [])]
    for ref in refs:
        validate_ref(ref, project, key_id)
    return refs


def export_copy(archive, manifest_ref, project, target, workers=1):
    target = Path(target)
    if target.exists() or not target.parent.is_dir() or target.parent.stat().st_mode & 0o077:
        raise backup.BackupError("Destinazione deve essere nuova in directory privata")
    validate_ref(manifest_ref, project, archive.key_id)
    partial = target.with_name(target.name + ".partial")
    if partial.exists():
        raise backup.BackupError("Esportazione parziale gia presente")
    try:
        with tempfile.TemporaryDirectory(prefix="offline-export-", dir=target.parent) as tmp:
            work = Path(tmp)
            archive.download(manifest_ref["key"], manifest_ref["version_id"], work / "manifest.gz")
            if backup.digest_file(work / "manifest.gz") != manifest_ref["sha256"]:
                raise backup.BackupError("Manifest diverso dal riferimento")
            manifest = json.loads(gzip.decompress((work / "manifest.gz").read_bytes()))
            refs = [manifest_ref] + references(manifest, project, archive.key_id)
            required = sum(r["bytes"] + len(aruba.MAGIC) + 28 + 1024 for r in refs)
            if shutil.disk_usage(target.parent).free < required * 2 + 1024**3:
                raise backup.BackupError("Spazio insufficiente per copia indipendente")
            def download(item):
                index, ref = item
                path = work / f"{index:08d}.cipher"
                response = archive.s3.get_object(Bucket=archive.bucket, Key=ref["key"], VersionId=ref["version_id"])
                try:
                    expected_size = ref["bytes"] + len(aruba.MAGIC) + 28
                    with open(path, "xb") as out:
                        remaining = expected_size
                        while remaining:
                            chunk = response["Body"].read(min(1024*1024, remaining))
                            if not chunk:
                                raise backup.BackupError("Copia cifrata troncata")
                            out.write(chunk); remaining -= len(chunk)
                        if response["Body"].read(1):
                            raise backup.BackupError("Copia cifrata oltre la dimensione attesa")
                finally:
                    response["Body"].close()
                if backup.digest_file(path) != ref["cipher_sha256"]:
                    raise backup.BackupError("Copia cifrata alterata")
                plain = work / f"{index:08d}.plain"
                try:
                    aruba.decrypt_file(path, plain, archive.key, ref["key"])
                    if plain.stat().st_size != ref["bytes"] or backup.digest_file(plain) != ref["sha256"]:
                        raise backup.BackupError("Contenuto indipendente diverso dal manifest")
                finally:
                    plain.unlink(missing_ok=True)
                return path
            with backup.ThreadPoolExecutor(max_workers=workers) as pool:
                for index, _ in enumerate(pool.map(download, enumerate(refs))):
                    if (index+1) % 250 == 0:
                        print(json.dumps({"offline_export_progress": index+1, "total": len(refs)}), flush=True)
            index_data = {"format": 1, "project_ref": project, "key_id": archive.key_id,
                "manifest": manifest_ref, "references": refs}
            with tarfile.open(partial, "x") as tar:
                raw = backup.canonical(index_data)
                info = tarfile.TarInfo("index.json"); info.size = len(raw); info.mode = 0o600
                tar.addfile(info, io.BytesIO(raw))
                for index in range(len(refs)):
                    tar.add(work / f"{index:08d}.cipher", arcname=f"{index:08d}.cipher", recursive=False)
            os.replace(partial, target)
        digest = backup.digest_file(target)
        target.with_name(target.name + ".sha256").write_text(digest + "\n")
        return {"status": "independent_encrypted_copy_created", "files": len(refs),
            "bytes": target.stat().st_size, "sha256": digest, "physical_offline_custody": False}
    finally:
        partial.unlink(missing_ok=True)


def verify_copy(source, key, expected_project):
    key_id = hashlib.sha256(key).hexdigest()[:16]
    with tarfile.open(source, "r") as tar, tempfile.TemporaryDirectory(prefix="offline-verify-") as tmp:
        work = Path(tmp)
        members = tar.getmembers()
        if (len(members) > 100000 or len({m.name for m in members}) != len(members) or
            any(not m.isfile() for m in members) or
            not members or members[0].name != "index.json" or members[0].size > 64*1024**2):
            raise backup.BackupError("Struttura copia indipendente non valida")
        index = json.load(tar.extractfile(members[0]))
        if index.get("format") != 1 or index.get("project_ref") != expected_project or index.get("key_id") != key_id:
            raise backup.BackupError("Chiave o progetto copia indipendente errati")
        refs = index["references"]
        if not refs or refs[0] != index["manifest"] or len(members) != len(refs)+1:
            raise backup.BackupError("Copia indipendente incompleta")
        for num, ref in enumerate(refs):
            validate_ref(ref, expected_project, key_id)
            member = members[num+1]
            if member.name != f"{num:08d}.cipher" or member.size != ref["bytes"] + len(aruba.MAGIC) + 28:
                raise backup.BackupError("File indipendente inatteso")
            encrypted, plain = work / "file.cipher", work / "file.plain"
            with tar.extractfile(member) as inp, open(encrypted, "wb") as out:
                shutil.copyfileobj(inp, out, 1024*1024)
            if backup.digest_file(encrypted) != ref["cipher_sha256"]:
                raise backup.BackupError("Copia cifrata alterata")
            aruba.decrypt_file(encrypted, plain, key, ref["key"])
            if backup.digest_file(plain) != ref["sha256"] or plain.stat().st_size != ref["bytes"]:
                raise backup.BackupError("Contenuto indipendente alterato")
            if num == 0:
                manifest = json.loads(gzip.decompress(plain.read_bytes()))
                if refs[1:] != references(manifest, expected_project, key_id):
                    raise backup.BackupError("Inventario diverso dal manifest autenticato")
            plain.unlink(); encrypted.unlink()
            if (num+1) % 250 == 0:
                print(json.dumps({"offline_verify_progress":num+1,"total":len(refs)}), flush=True)
    return {"status":"independent_encrypted_copy_verified", "files":len(refs),
        "all_plaintext_hashes_match":True, "physical_offline_custody":False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("export", "verify"))
    parser.add_argument("--config", default="scripts/backup/aruba-config.json")
    parser.add_argument("--secrets", required=True)
    parser.add_argument("--result")
    parser.add_argument("--file", required=True)
    args = parser.parse_args(); os.umask(0o077)
    config = aruba.validate_config(json.loads(Path(args.config).read_text()))
    secret = aruba.load_secret(args.secrets)
    if args.command == "export":
        if not args.result:
            raise backup.BackupError("Manca riferimento checkpoint")
        result = json.loads(Path(args.result).read_text())
        output = export_copy(connect(config, secret), result["manifest"], config["project_ref"],
            args.file, config.get("storage_workers", 1))
    else:
        output = verify_copy(args.file, aruba.encryption_key(secret), config["project_ref"])
    print(json.dumps(output), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status":"independent_copy_failed", "error_type":type(error).__name__}), flush=True)
        raise SystemExit(1)
