#!/usr/bin/env python3
"""Backup read-only di Supabase; scritture esclusivamente nell'archivio AWS.

Nessun restore automatico e nessun messaggio contenente nomi file o segreti.
Dipendenze importate solo nel comando operativo per consentire test offline.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import base64
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

UTC = dt.timezone.utc
MAX_FILE_BYTES = 2 * 1024 ** 3


class BackupError(Exception):
    """Messaggio tecnico senza dati provenienti dai provider."""


class SourceNotFound(BackupError):
    """Il provider dichiara assenti i byte, senza includere il percorso."""


def source_checksum_matches(path, metadata):
    etag = str(metadata.get("eTag", "")).strip('"').lower()
    if not re.fullmatch(r"[a-f0-9]{32}(?:-1)?", etag):
        return False
    md5 = hashlib.md5(usedforsecurity=False)
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            md5.update(chunk)
    checksum = hashlib.md5(md5.digest(), usedforsecurity=False).hexdigest() + "-1" if etag.endswith("-1") else md5.hexdigest()
    return path.stat().st_size == metadata.get("size") and checksum == etag


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()


def digest_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def revision_key(project, row):
    # Percorsi e CF non sono visibili nei nomi oggetto o nei log S3.
    revision = {k: row.get(k) for k in
                ("id", "bucket_id", "name", "updated_at", "metadata", "version")}
    return f"{project}/objects/{hashlib.sha256(canonical(revision)).hexdigest()}"


def validate_config(config):
    if config.get("region") != "eu-central-1":
        raise BackupError("Archivio atteso nella regione UE di Francoforte")
    return validate_snapshot_config(config)


def validate_snapshot_config(config):
    if not re.fullmatch(r"[a-z]{20}", config.get("project_ref", "")):
        raise BackupError("Configurazione project ref non valida")
    days = config.get("snapshot_days")
    objects = config.get("object_days")
    if not isinstance(days, int) or not isinstance(objects, int) or not 1 <= days <= 90 or objects < days + 30:
        raise BackupError("Conservazione incoerente tra snapshot e allegati")
    if not 1 <= config.get("hourly_days", 2) <= config.get("daily_days", 30) <= days:
        raise BackupError("Conservazione oraria/giornaliera non valida")
    workers = config.get("storage_workers", 1)
    if type(workers) is not int or not 1 <= workers <= 8:
        raise BackupError("Parallelismo Storage non valido")
    nightly = config.get("nightly_hour_utc", 2)
    if type(nightly) is not int or not 0 <= nightly <= 23:
        raise BackupError("Ora del controllo notturno non valida")
    return config


def retention_days(config, now):
    if now.hour == config.get("nightly_hour_utc", 2):
        return config["snapshot_days"] if now.weekday() == 6 else config.get("daily_days", 30)
    return config.get("hourly_days", 2)


def connection_options(database, project):
    host = database.get("host", "")
    user = database.get("user", "")
    direct = host == f"db.{project}.supabase.co"
    pooled = bool(re.fullmatch(r"aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com", host))
    if not (direct or (pooled and user == f"postgres.{project}")):
        raise BackupError("La connessione DB non identifica il progetto atteso")
    if database.get("port", 5432) != 5432 or database.get("dbname", "postgres") != "postgres":
        raise BackupError("Usare connessione diretta o session pooler sulla porta 5432")
    if not user or not database.get("password"):
        raise BackupError("Credenziali database mancanti")
    rootcert = database.get("sslrootcert", "/etc/ssl/certs/ca-certificates.crt")
    if not isinstance(rootcert, str) or not Path(rootcert).is_absolute():
        raise BackupError("Il certificato CA database richiede un percorso assoluto")
    return dict(host=host, user=user, password=database["password"],
                port=5432, dbname="postgres", sslmode="verify-full",
                sslrootcert=rootcert, connect_timeout=20)


def pg_environment(options):
    env = os.environ.copy()
    for key in list(env):
        if key.startswith("PG"):
            del env[key]
    for name, key in [("PGHOST", "host"), ("PGPORT", "port"), ("PGUSER", "user"),
                      ("PGPASSWORD", "password"), ("PGDATABASE", "dbname"),
                      ("PGSSLMODE", "sslmode"), ("PGSSLROOTCERT", "sslrootcert")]:
        env[name] = str(options[key])
    env["PGOPTIONS"] = "-c default_transaction_read_only=on -c statement_timeout=1800000"
    return env


def run_tool(args, env, output=None):
    try:
        result = subprocess.run(args, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=1800, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise BackupError("Strumento di export non disponibile o scaduto") from None
    if result.returncode or result.stderr.strip():
        # Anche i warning pg_dump richiedono revisione: non dichiarare un export completo.
        raise BackupError("Export non verificato: controllare privilegi o compatibilita client")
    if output:
        Path(output).write_bytes(result.stdout)
    return result.stdout


def download_source(project, token, row, path):
    encoded = urllib.parse.quote(row["bucket_id"], safe="") + "/" + urllib.parse.quote(row["name"], safe="/")
    url = f"https://{project}.supabase.co/storage/v1/object/authenticated/{encoded}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "apikey": token})
    # Non seguire redirect: la chiave non deve raggiungere un host diverso.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect())
    for attempt in range(3):
        try:
            with opener.open(req, timeout=90) as response, open(path, "wb") as target:
                total = 0
                for chunk in iter(lambda: response.read(1024 * 1024), b""):
                    total += len(chunk)
                    if total > MAX_FILE_BYTES:
                        raise BackupError("Allegato oltre il limite operativo")
                    target.write(chunk)
            metadata = row.get("metadata") or {}
            expected = metadata.get("size")
            if expected is not None and total != int(expected):
                raise BackupError("Dimensione allegato diversa dall'inventario DB")
            return
        except urllib.error.HTTPError as error:
            if error.code in (400, 404):
                try:
                    details = json.loads(error.read(8192))
                except (ValueError, OSError):
                    details = {}
                if error.code == 404 or (str(details.get("statusCode")) == "404" and details.get("error") == "not_found"):
                    raise SourceNotFound("Byte del documento assenti nella sorgente") from None
            if error.code not in (429, 500, 502, 503, 504):
                raise BackupError("Allegato snapshot non recuperabile") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(attempt + 1)
    raise BackupError("Download allegato non riuscito")


class Archive:
    def __init__(self, s3, bucket, now):
        self.s3, self.bucket, self.now = s3, bucket, now

    def preflight(self):
        s3, bucket = self.s3, self.bucket
        region = s3.get_bucket_location(Bucket=bucket).get("LocationConstraint")
        version = s3.get_bucket_versioning(Bucket=bucket).get("Status")
        lock = s3.get_object_lock_configuration(Bucket=bucket).get("ObjectLockConfiguration", {})
        public = s3.get_public_access_block(Bucket=bucket).get("PublicAccessBlockConfiguration", {})
        encryption = s3.get_bucket_encryption(Bucket=bucket)
        if region != "eu-central-1" or version != "Enabled" or lock.get("ObjectLockEnabled") != "Enabled":
            raise BackupError("Archivio senza regione/versioni/Object Lock richiesti")
        if not all(public.get(k) for k in ("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")):
            raise BackupError("L'archivio non blocca tutti gli accessi pubblici")
        if not encryption.get("ServerSideEncryptionConfiguration", {}).get("Rules"):
            raise BackupError("Cifratura archivio non configurata")

    def head(self, key):
        try:
            return self.s3.head_object(Bucket=self.bucket, Key=key, ChecksumMode="ENABLED")
        except Exception as error:
            code = getattr(error, "response", {}).get("Error", {}).get("Code")
            if code in ("404", "NoSuchKey", "NotFound"):
                return None
            raise

    def reference(self, key, head, days, expected=None):
        sha = head.get("Metadata", {}).get("sha256", "")
        checksum = base64.b64encode(bytes.fromhex(sha)).decode() if re.fullmatch(r"[a-f0-9]{64}", sha) else ""
        if not checksum or head.get("ChecksumSHA256") != checksum or not head.get("VersionId"):
            raise BackupError("Versione archivio priva di integrita verificabile")
        if expected and sha != expected:
            raise BackupError("Hash archivio diverso dai dati copiati")
        until = self.now + dt.timedelta(days=days)
        current = head.get("ObjectLockRetainUntilDate")
        if head.get("ObjectLockMode") != "GOVERNANCE" or not current:
            raise BackupError("Versione archivio senza protezione dalla cancellazione")
        if current < until - dt.timedelta(days=29):
            self.s3.put_object_retention(Bucket=self.bucket, Key=key, VersionId=head["VersionId"],
                                         Retention={"Mode": "GOVERNANCE", "RetainUntilDate": until})
        return {"key": key, "version_id": head["VersionId"], "sha256": sha, "bytes": head["ContentLength"]}

    def put(self, key, path, days):
        sha = digest_file(path)
        with open(path, "rb") as stream:
            result = self.s3.put_object(Bucket=self.bucket, Key=key, Body=stream,
                Metadata={"sha256": sha}, ChecksumSHA256=base64.b64encode(bytes.fromhex(sha)).decode(),
                ServerSideEncryption="AES256", ObjectLockMode="GOVERNANCE",
                Tagging="retention-days=" + str(days),
                ObjectLockRetainUntilDate=self.now + dt.timedelta(days=days))
        head = self.head(key)
        if not head or head.get("VersionId") != result.get("VersionId"):
            raise BackupError("Versione caricata non verificabile")
        return self.reference(key, head, days, sha)


def capture_database(connection, options, work):
    """DB e inventario Storage condividono lo stesso snapshot PostgreSQL."""
    connection.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
    snapshot = connection.execute("SELECT pg_export_snapshot() AS snapshot").fetchone()["snapshot"]
    buckets = connection.execute("SELECT * FROM storage.buckets ORDER BY id").fetchall()
    objects = connection.execute("SELECT * FROM storage.objects ORDER BY bucket_id, name").fetchall()
    vault_count = connection.execute("SELECT count(*) AS n FROM vault.secrets").fetchone()["n"]
    env = pg_environment(options)
    dump = work / "database.dump"
    run_tool(["pg_dump", "--format=custom", "--snapshot=" + snapshot,
              "--lock-wait-timeout=20s", "--file=" + str(dump)], env)
    toc = run_tool(["pg_restore", "--list", str(dump)], env)
    for schema, table in [("auth", "users"), ("public", "profili"), ("storage", "objects")]:
        if f"TABLE DATA {schema} {table} ".encode() not in toc:
            raise BackupError("Export privo di dati indispensabili per Auth/CRM/Storage")
    # Ruoli globali senza password; possono cambiare indipendentemente dallo snapshot DB.
    run_tool(["pg_dumpall", "--roles-only", "--no-role-passwords"], env, work / "roles.sql")
    connection.execute("ROLLBACK")
    return buckets, objects, vault_count


def stable_source(connection, original):
    current = connection.execute("SELECT * FROM storage.objects WHERE id=%s", (original["id"],)).fetchone()
    return current is not None and revision_key("source", current) == revision_key("source", original)


def capture_repositories(secret, archive, work, project, days):
    repositories = secret.get("repositories", [])
    if not repositories:
        return [], False
    token = secret.get("github_read_token")
    env = os.environ.copy()
    env.update(GIT_TERMINAL_PROMPT="0")
    for name in ("GIT_ASKPASS", "BACKUP_GITHUB_TOKEN"):
        env.pop(name, None)
    # I repository pubblici vengono letti senza creare o trasferire credenziali.
    # Un repository privato inaccessibile fa fallire il job, mai un manifest parziale.
    if token:
        askpass = work / "git-askpass.sh"
        askpass.write_text('#!/bin/sh\ncase "$1" in\n*Username*) printf "%s" "x-access-token" ;;\n*) printf "%s" "$BACKUP_GITHUB_TOKEN" ;;\nesac\n')
        askpass.chmod(0o700)
        env.update(GIT_ASKPASS=str(askpass), BACKUP_GITHUB_TOKEN=token)
    result = []
    for index, repository in enumerate(repositories):
        if not re.fullmatch(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git", repository):
            raise BackupError("URL repository non ammessa")
        mirror = work / f"repo-{index}.git"
        run_tool(["git", "-c", "credential.helper=", "clone", "--quiet", "--mirror", repository, str(mirror)], env)
        bundle = work / f"repo-{index}.bundle"
        run_tool(["git", "-C", str(mirror), "bundle", "create", str(bundle), "--all", "--quiet"], env)
        sha = digest_file(bundle)
        key = f"{project}/code/{sha}.bundle"
        head = archive.head(key)
        ref = archive.reference(key, head, days, sha) if head else archive.put(key, bundle, days)
        result.append({"repository": repository, "archive": ref})
        shutil.rmtree(mirror)
        bundle.unlink()
    return result, True


def capture(config, secret, archive, connection, work, full_verify=False, downloader=download_source):
    now = archive.now
    project = config["project_ref"]
    snapshot_days = retention_days(config, now)
    prefix = f"{project}/snapshots/{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex}"
    options = connection_options(secret.get("database", {}), project)
    token = secret.get("storage_key")
    if not token:
        raise BackupError("Chiave server-only Storage mancante")
    archive.preflight()
    buckets, rows, vault_count = capture_database(connection, options, work)
    if not set(config["minimum_buckets"]).issubset({b["id"] for b in buckets}):
        raise BackupError("Inventario privo di uno o piu bucket attesi")
    if vault_count and not secret.get("vault_recovery", {}).get("encryption_root_key"):
        raise BackupError("Vault contiene segreti: manca la chiave di recupero separata")
    source_lock = threading.Lock()
    cancelled = threading.Event()
    duplicates = {}
    for row in rows:
        meta = row.get("metadata") or {}
        if meta.get("eTag") and meta.get("size") is not None:
            duplicates.setdefault((meta["eTag"], meta["size"]), []).append(row)
    def copy_object(row):
        if cancelled.is_set():
            raise BackupError("Copia interrotta dopo errore")
        key = revision_key(project, row)
        head = archive.head(key)
        recovered = None
        if not head or full_verify:
            with tempfile.TemporaryDirectory(prefix="object-", dir=work) as temporary:
                path = Path(temporary) / "attachment.bin"
                try:
                    downloader(project, token, row, path)
                except SourceNotFound:
                    meta = row.get("metadata") or {}
                    for candidate in duplicates.get((meta.get("eTag"), meta.get("size")), []):
                        if candidate["id"] == row["id"]:
                            continue
                        try:
                            downloader(project, token, candidate, path)
                        except SourceNotFound:
                            continue
                        with source_lock:
                            candidate_stable = stable_source(connection, candidate)
                        if candidate_stable and source_checksum_matches(path, meta):
                            recovered = candidate["id"]
                            break
                    if recovered is None:
                        raise SourceNotFound("Documento assente senza duplicato verificabile") from None
                # La connessione DB condivisa resta seriale; i file sono separati.
                with source_lock:
                    stable = stable_source(connection, row)
                if not stable:
                    raise BackupError("Storage modificato durante la copia: ripetere il backup")
                sha = digest_file(path)
                reference = archive.reference(key, head, config["object_days"], sha) if head else archive.put(key, path, config["object_days"])
        else:
            reference = archive.reference(key, head, config["object_days"])
        result = {"source": row, "archive": reference}
        if recovered is not None:
            result["recovered_from_duplicate"] = recovered
        return result
    references = []
    pool = ThreadPoolExecutor(max_workers=config.get("storage_workers", 1))
    try:
        for index, reference in enumerate(pool.map(copy_object, rows)):
            references.append(reference)
            if (index + 1) % 250 == 0:
                print(json.dumps({"copied_or_verified": index + 1, "total": len(rows)}), flush=True)
    except BaseException:
        cancelled.set()
        raise
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
    manifest = {"format": 1, "status": "complete", "project_ref": project,
                "started_at": now.isoformat(), "committed_at": dt.datetime.now(UTC).isoformat(),
                "buckets": buckets, "objects": references,
                "scope": "database_and_storage", "full_source_verification": full_verify,
                "platform_recovery_inventory": secret.get("platform_recovery", {}).get("status") == "verified"}
    for name in ("database.dump", "roles.sql"):
        manifest[name] = archive.put(prefix + "/" + name, work / name, snapshot_days)
    manifest["repositories"], manifest["repository_coverage_configured"] = capture_repositories(
        secret, archive, work, project, config["object_days"])
    # Le configurazioni fornite sono protette come i dati; mai stampate nei log.
    recovery = work / "recovery.json"
    recovery.write_bytes(canonical({"platform_recovery": secret.get("platform_recovery", {}),
                                    "vault_recovery": secret.get("vault_recovery", {}),
                                    "database_role_passwords": secret.get("database_role_passwords", {})}))
    manifest["recovery.json"] = archive.put(prefix + "/recovery.json", recovery, snapshot_days)
    source = Path("recovery-source.zip")
    if source.exists():
        key = f"{project}/code/{digest_file(source)}.zip"
        head = archive.head(key)
        manifest["recovery-source.zip"] = archive.reference(key, head, config["object_days"], digest_file(source)) if head else archive.put(key, source, config["object_days"])
    path = work / "manifest.json.gz"
    path.write_bytes(gzip.compress(canonical(manifest), mtime=0))
    # Commit del punto di recupero per ultimo: nessun manifest completo dopo un errore.
    reference = archive.put(prefix + "/manifest.json.gz", path, snapshot_days)
    return {"manifest": reference, "objects": len(rows), "buckets": len(buckets),
            "recovered_from_duplicates": sum("recovered_from_duplicate" in r for r in references)}


def verify_manifest(s3, bucket, key, version_id, directory):
    """Scarica e verifica ogni byte; non scrive mai su Supabase."""
    response = s3.get_object(Bucket=bucket, Key=key, VersionId=version_id)
    raw = response["Body"].read()
    sha = hashlib.sha256(raw).hexdigest()
    if sha != response.get("Metadata", {}).get("sha256"):
        raise BackupError("Manifest alterato")
    manifest = json.loads(gzip.decompress(raw))
    project = manifest.get("project_ref", "")
    if manifest.get("format") != 1 or manifest.get("status") != "complete" or not re.fullmatch(r"[a-z]{20}", project):
        raise BackupError("Manifest non completo o formato non supportato")
    refs = [r["archive"] for r in manifest["objects"]]
    refs += [manifest[name] for name in ("database.dump", "roles.sql", "recovery.json")]
    if "recovery-source.zip" in manifest:
        refs.append(manifest["recovery-source.zip"])
    refs += [repo["archive"] for repo in manifest.get("repositories", [])]
    for index, ref in enumerate(refs):
        if not ref["key"].startswith(project + "/") or not ref.get("version_id"):
            raise BackupError("Riferimento archivio non valido")
        obj = s3.get_object(Bucket=bucket, Key=ref["key"], VersionId=ref["version_id"])
        digest, size = hashlib.sha256(), 0
        # Nomi locali opachi: nessun path traversal dai nomi Storage.
        with open(directory / f"{index:08d}.bin", "wb") as target:
            for chunk in iter(lambda: obj["Body"].read(1024 * 1024), b""):
                size += len(chunk)
                digest.update(chunk)
                target.write(chunk)
        if digest.hexdigest() != ref["sha256"] or size != ref["bytes"]:
            raise BackupError("Un file del backup e' corrotto o incompleto")
    (directory / "manifest.json").write_bytes(canonical(manifest))
    return len(refs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["capture", "verify"])
    parser.add_argument("--config", default=str(Path(__file__).with_name("config.json")))
    parser.add_argument("--bucket", default=os.environ.get("BACKUP_BUCKET"))
    parser.add_argument("--manifest-key")
    parser.add_argument("--manifest-version")
    parser.add_argument("--output")
    parser.add_argument("--full-verify", action="store_true")
    args = parser.parse_args()
    config = validate_config(json.loads(Path(args.config).read_text()))
    if not args.bucket:
        raise BackupError("Bucket di destinazione mancante")
    import boto3
    from botocore.config import Config
    session = boto3.Session(region_name=config["region"])
    s3 = session.client("s3", config=Config(retries={"max_attempts": 5, "mode": "standard"}))
    if args.command == "verify":
        if not args.output or not args.manifest_key or not args.manifest_version:
            raise BackupError("Verify richiede output, chiave e versione del manifest")
        directory = Path(args.output)
        directory.mkdir(mode=0o700, parents=True, exist_ok=False)
        verified = verify_manifest(s3, args.bucket, args.manifest_key, args.manifest_version, directory)
        print(json.dumps({"verified_files": verified}))
        return
    import psycopg
    from psycopg.rows import dict_row
    arn = os.environ.get("BACKUP_SECRET_ARN")
    if not arn:
        raise BackupError("Secret ARN mancante")
    secret = json.loads(session.client("secretsmanager").get_secret_value(SecretId=arn)["SecretString"])
    options = connection_options(secret.get("database", {}), config["project_ref"])
    now = dt.datetime.now(UTC)
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="mirox-backup-") as tmp:
        with psycopg.connect(**options, autocommit=True, row_factory=dict_row) as connection:
            # Lease read-only a livello sessione; nessuna tabella nuova.
            locked = connection.execute("SELECT pg_try_advisory_lock(72406392841004) AS locked").fetchone()["locked"]
            if not locked:
                raise BackupError("Un altro backup sta gia lavorando")
            result = capture(config, secret, Archive(s3, args.bucket, now), connection,
                             Path(tmp), args.full_verify or now.hour == config.get("nightly_hour_utc", 2))
    session.client("cloudwatch").put_metric_data(Namespace="MiroxBackup",
        MetricData=[{"MetricName": "CompleteSnapshot", "Value": 1, "Unit": "Count",
                     "Dimensions": [{"Name": "Project", "Value": config["project_ref"]}]}])
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # I messaggi degli SDK possono contenere URL, nomi file e credenziali.
        message = str(error) if isinstance(error, BackupError) else "Errore del provider o della connessione"
        print(json.dumps({"status": "failed", "reason": message}), flush=True)
        raise SystemExit(1)
