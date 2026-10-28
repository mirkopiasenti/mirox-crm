#!/usr/bin/env python3
"""Runner Aruba: copie cifrate lato client, versionate e Object Lock Compliance.

Credenziali in un file privato o in LoadCredential systemd, mai nelle argv.
Nessuna creazione di servizi, cancellazione archivio o scrittura Supabase.
"""
import argparse
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import urllib.error
import urllib.request

import backup

MAGIC = b"MIROXARUBA1\x00"
ENCRYPTION = "aes256gcm-v1"
ENDPOINTS = {"R1-IT": "https://r1-it.storage.cloud.it",
             "R3-IT": "https://r3-it.storage.cloud.it"}


def validate_config(config):
    # La region di firma S3 non rappresenta la localizzazione dei dati.
    if config.get("provider") != "aruba" or config.get("endpoint_url") != ENDPOINTS.get(config.get("data_region")):
        raise backup.BackupError("Endpoint Aruba non italiano o non riconosciuto")
    if not re.fullmatch(r"[a-z0-9-]{1,40}", config.get("signing_region", "")):
        raise backup.BackupError("Regione di firma S3 mancante")
    backup.validate_snapshot_config(config)
    return config


def load_secret(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        private_file = info.st_uid == os.geteuid() and not info.st_mode & 0o077
        systemd_file = False
        credential_dir = os.environ.get("CREDENTIALS_DIRECTORY")
        if credential_dir:
            directory = Path(credential_dir).resolve()
            candidate = Path(path)
            if (directory.is_relative_to("/run/credentials") and
                    candidate.parent.resolve() == directory and candidate.name == "private.json"):
                parent = directory.stat()
                systemd_file = (info.st_uid == 0 and info.st_gid == 0 and
                    stat.S_IMODE(info.st_mode) in (0o400, 0o440) and
                    parent.st_uid == 0 and parent.st_gid == 0 and
                    stat.S_IMODE(parent.st_mode) == 0o550 and
                    bool(os.fstatvfs(stream.fileno()).f_flag & os.ST_RDONLY))
        if not stat.S_ISREG(info.st_mode) or not (private_file or systemd_file):
            raise backup.BackupError("File credenziali non privato o proprietario diverso")
        return json.load(stream)


def encryption_key(secret):
    try:
        key = base64.b64decode(secret["archive"]["encryption_key_b64"], validate=True)
    except (KeyError, ValueError, TypeError):
        raise backup.BackupError("Chiave di cifratura mancante o non valida") from None
    if len(key) != 32:
        raise backup.BackupError("La chiave di cifratura deve contenere 32 byte casuali")
    return key


def encrypt_file(source, target, key, context):
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    nonce = os.urandom(12)
    header = MAGIC + nonce
    cipher = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    cipher.authenticate_additional_data(header + context.encode())
    with open(source, "rb") as src, open(target, "xb") as dst:
        dst.write(header)
        for chunk in iter(lambda: src.read(1024 * 1024), b""):
            dst.write(cipher.update(chunk))
        dst.write(cipher.finalize())
        dst.write(cipher.tag)


def decrypt_file(source, target, key, context):
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    temporary = Path(str(target) + ".unauthenticated")
    try:
        with open(source, "rb") as src:
            size = os.fstat(src.fileno()).st_size
            header = src.read(len(MAGIC) + 12)
            if size < len(MAGIC) + 28 or not header.startswith(MAGIC):
                raise backup.BackupError("Formato cifrato non valido")
            src.seek(-16, os.SEEK_END)
            tag = src.read(16)
            src.seek(len(header))
            cipher = Cipher(algorithms.AES(key), modes.GCM(header[len(MAGIC):], tag)).decryptor()
            cipher.authenticate_additional_data(header + context.encode())
            remaining = size - len(header) - 16
            with open(temporary, "xb") as dst:
                while remaining:
                    chunk = src.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise backup.BackupError("Archivio cifrato troncato")
                    remaining -= len(chunk)
                    dst.write(cipher.update(chunk))
                dst.write(cipher.finalize())
            # Il file in chiaro diventa utilizzabile soltanto dopo il tag GCM valido.
            os.replace(temporary, target)
    except InvalidTag:
        raise backup.BackupError("Chiave errata o archivio cifrato alterato") from None
    finally:
        temporary.unlink(missing_ok=True)


class Archive:
    def __init__(self, s3, bucket, now, key, verify_reused=False):
        self.s3, self.bucket, self.now, self.key = s3, bucket, now, key
        self.key_id = hashlib.sha256(key).hexdigest()[:16]
        self.verify_reused = verify_reused
        self.verified_versions = set()

    def preflight(self):
        version = self.s3.get_bucket_versioning(Bucket=self.bucket)
        lock = self.s3.get_object_lock_configuration(Bucket=self.bucket)
        if version.get("Status") != "Enabled" or lock.get("ObjectLockConfiguration", {}).get("ObjectLockEnabled") != "Enabled":
            raise backup.BackupError("Archivio Aruba senza versioni e Object Lock")
        acl = self.s3.get_bucket_acl(Bucket=self.bucket)
        owner = acl.get("Owner", {}).get("ID")
        grants = acl.get("Grants", [])
        if not owner or not grants or any(g.get("Grantee", {}).get("Type") != "CanonicalUser" or
                g["Grantee"].get("ID") != owner for g in grants):
            raise backup.BackupError("ACL archivio non privata")
        try:
            policy = self.s3.get_bucket_policy(Bucket=self.bucket)
        except Exception as error:
            code = getattr(error, "response", {}).get("Error", {}).get("Code")
            if code != "NoSuchBucketPolicy":
                raise
        else:
            # Nessuna policy aggiuntiva e' ammessa in questa prima configurazione.
            if json.loads(policy.get("Policy", "{}")):
                raise backup.BackupError("Policy archivio da verificare prima del backup")

    def head(self, key):
        try:
            return self.s3.head_object(Bucket=self.bucket, Key=key)
        except Exception as error:
            code = getattr(error, "response", {}).get("Error", {}).get("Code")
            if code in ("404", "NoSuchKey", "NotFound"):
                return None
            raise

    def reference(self, key, head, days, expected=None):
        meta = head.get("Metadata", {})
        sha, stored_sha = meta.get("sha256", ""), meta.get("cipher-sha256", "")
        version = head.get("VersionId")
        if (not re.fullmatch(r"[a-f0-9]{64}", sha) or not re.fullmatch(r"[a-f0-9]{64}", stored_sha) or
                not version or version == "null" or meta.get("encryption") != ENCRYPTION or meta.get("key-id") != self.key_id):
            raise backup.BackupError("Versione Aruba priva di cifratura/integrita verificabile")
        size = int(meta.get("plain-bytes", "-1"))
        if size < 0 or head.get("ContentLength") != size + len(MAGIC) + 28 or (expected and sha != expected):
            raise backup.BackupError("Dimensione o hash archivio diverso dalla copia attesa")
        retention = self.s3.get_object_retention(Bucket=self.bucket, Key=key, VersionId=version).get("Retention", {})
        current = retention.get("RetainUntilDate")
        if retention.get("Mode") != "COMPLIANCE" or not current:
            raise backup.BackupError("Versione Aruba senza Object Lock Compliance")
        until = self.now + dt.timedelta(days=days)
        if current < until - dt.timedelta(days=29):
            self.s3.put_object_retention(Bucket=self.bucket, Key=key, VersionId=version,
                Retention={"Mode": "COMPLIANCE", "RetainUntilDate": until})
            confirmed = self.s3.get_object_retention(Bucket=self.bucket, Key=key, VersionId=version).get("Retention", {})
            if confirmed.get("Mode") != "COMPLIANCE" or confirmed.get("RetainUntilDate", self.now) < until:
                raise backup.BackupError("Estensione Object Lock non confermata")
        ref = {"key": key, "version_id": version, "sha256": sha, "bytes": size,
               "cipher_sha256": stored_sha, "encryption": ENCRYPTION, "key_id": self.key_id}
        if self.verify_reused and (key, version) not in self.verified_versions:
            self.check_bytes(ref)
        return ref

    def download(self, key, version, target):
        obj = self.s3.get_object(Bucket=self.bucket, Key=key, VersionId=version)
        if obj.get("VersionId") != version:
            raise backup.BackupError("Versione scaricata diversa da quella richiesta")
        meta = obj.get("Metadata", {})
        if meta.get("encryption") != ENCRYPTION or meta.get("key-id") != self.key_id:
            raise backup.BackupError("Chiave o formato dell'archivio diverso")
        encrypted = Path(str(target) + ".encrypted")
        try:
            total = 0
            with open(encrypted, "xb") as dst:
                try:
                    for chunk in iter(lambda: obj["Body"].read(1024 * 1024), b""):
                        total += len(chunk)
                        if total > backup.MAX_FILE_BYTES + len(MAGIC) + 28:
                            raise backup.BackupError("Versione oltre il limite operativo")
                        dst.write(chunk)
                finally:
                    obj["Body"].close()
            if total != obj.get("ContentLength") or backup.digest_file(encrypted) != meta.get("cipher-sha256"):
                raise backup.BackupError("Byte cifrati corrotti o incompleti")
            decrypt_file(encrypted, target, self.key, key)
            if target.stat().st_size != int(meta.get("plain-bytes", "-1")) or backup.digest_file(target) != meta.get("sha256"):
                target.unlink()
                raise backup.BackupError("Byte decifrati diversi dall'inventario")
        finally:
            encrypted.unlink(missing_ok=True)
        return meta

    def check_bytes(self, ref):
        with tempfile.TemporaryDirectory(prefix="mirox-aruba-check-") as tmp:
            target = Path(tmp) / "plain.bin"
            self.download(ref["key"], ref["version_id"], target)
            if target.stat().st_size != ref["bytes"] or backup.digest_file(target) != ref["sha256"]:
                raise backup.BackupError("Byte archivio diversi dal riferimento")
        self.verified_versions.add((ref["key"], ref["version_id"]))

    def put(self, key, path, days):
        size, sha = path.stat().st_size, backup.digest_file(path)
        if size > backup.MAX_FILE_BYTES:
            raise backup.BackupError("File oltre il limite operativo")
        with tempfile.TemporaryDirectory(prefix="mirox-aruba-encrypt-") as tmp:
            encrypted = Path(tmp) / "encrypted.bin"
            encrypt_file(path, encrypted, self.key, key)
            cipher_sha = backup.digest_file(encrypted)
            md5 = hashlib.md5(usedforsecurity=False)
            with open(encrypted, "rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    md5.update(chunk)
            with open(encrypted, "rb") as stream:
                result = self.s3.put_object(Bucket=self.bucket, Key=key, Body=stream,
                    ACL="private", ContentMD5=base64.b64encode(md5.digest()).decode(),
                    Metadata={"sha256": sha, "cipher-sha256": cipher_sha, "plain-bytes": str(size),
                              "encryption": ENCRYPTION, "key-id": self.key_id},
                    ObjectLockMode="COMPLIANCE", ObjectLockRetainUntilDate=self.now + dt.timedelta(days=days),
                    Tagging="retention-days=" + str(days))
        head = self.head(key)
        if not head or head.get("VersionId") != result.get("VersionId"):
            raise backup.BackupError("Versione caricata non confermata")
        ref = self.reference(key, head, days, sha)
        if (key, ref["version_id"]) not in self.verified_versions:
            self.check_bytes(ref)
        return ref


def verify_manifest(archive, key, version, directory, workers=1):
    manifest_path = directory / "manifest.json.gz"
    archive.download(key, version, manifest_path)
    import gzip
    manifest = json.loads(gzip.decompress(manifest_path.read_bytes()))
    project = manifest.get("project_ref", "")
    if manifest.get("format") != 1 or manifest.get("status") != "complete" or not re.fullmatch(r"[a-z]{20}", project):
        raise backup.BackupError("Manifest non completo o formato non supportato")
    refs = [r["archive"] for r in manifest["objects"]]
    refs += [manifest[name] for name in ("database.dump", "roles.sql", "recovery.json")]
    if "recovery-source.zip" in manifest:
        refs.append(manifest["recovery-source.zip"])
    refs += [repo["archive"] for repo in manifest.get("repositories", [])]
    def verify_file(item):
        index, ref = item
        if (not ref["key"].startswith(project + "/") or not ref.get("version_id") or
                ref.get("encryption") != ENCRYPTION or ref.get("key_id") != archive.key_id):
            raise backup.BackupError("Riferimento cifrato non valido")
        target = directory / f"{index:08d}.bin"
        meta = archive.download(ref["key"], ref["version_id"], target)
        if (meta.get("cipher-sha256") != ref["cipher_sha256"] or backup.digest_file(target) != ref["sha256"] or
                target.stat().st_size != ref["bytes"]):
            target.unlink()
            raise backup.BackupError("File diverso da quello referenziato nel manifest")
    with backup.ThreadPoolExecutor(max_workers=workers) as pool:
        for index, _ in enumerate(pool.map(verify_file, enumerate(refs))):
            if (index + 1) % 250 == 0:
                print(json.dumps({"verified_files_progress": index + 1, "total": len(refs)}), flush=True)
    (directory / "manifest.json").write_bytes(backup.canonical(manifest))
    return len(refs)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def notify(url, status):
    if not re.fullmatch(r"https://hc-ping\.com/[a-f0-9-]{36}", url or ""):
        raise backup.BackupError("Monitor esterno non configurato")
    suffix = {"start": "/start", "failed": "/fail", "complete": ""}[status]
    request = urllib.request.Request(url + suffix, data=b"", method="POST")
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
            if response.status != 200:
                raise backup.BackupError("Monitor esterno non raggiungibile")
    except (urllib.error.URLError, TimeoutError, OSError):
        raise backup.BackupError("Monitor esterno non raggiungibile") from None


def run_monitored(monitor_url, callback):
    notify(monitor_url, "start")
    try:
        result = callback()
        notify(monitor_url, "complete")
        return result
    except Exception:
        try:
            notify(monitor_url, "failed")
        except backup.BackupError:
            pass
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["preflight", "capture", "verify"])
    parser.add_argument("--config", default=str(Path(__file__).with_name("aruba-config.json")))
    credential_dir = os.environ.get("CREDENTIALS_DIRECTORY")
    parser.add_argument("--secrets", default=str(Path(credential_dir) / "private.json") if credential_dir else None)
    parser.add_argument("--manifest-key")
    parser.add_argument("--manifest-version")
    parser.add_argument("--output")
    parser.add_argument("--full-verify", action="store_true")
    args = parser.parse_args()
    config = validate_config(json.loads(Path(args.config).read_text()))
    if not args.secrets:
        raise backup.BackupError("File credenziali mancante")
    os.umask(0o077)
    secret = load_secret(args.secrets)
    archive_secret = secret.get("archive", {})
    key = encryption_key(secret)
    bucket = archive_secret.get("bucket")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", bucket or ""):
        raise backup.BackupError("Nome bucket Aruba non valido")
    import boto3
    from botocore.config import Config
    for field in ("access_key", "secret_key"):
        if not archive_secret.get(field):
            raise backup.BackupError("Credenziali archivio mancanti")
    s3 = boto3.client("s3", endpoint_url=config["endpoint_url"], region_name=config["signing_region"],
        aws_access_key_id=archive_secret["access_key"], aws_secret_access_key=archive_secret["secret_key"],
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                      request_checksum_calculation="when_required", response_checksum_validation="when_required",
                      retries={"max_attempts": 5, "mode": "standard"}))
    now = dt.datetime.now(backup.UTC)
    verify_all = args.full_verify or now.hour == config.get("nightly_hour_utc", 2)
    archive = Archive(s3, bucket, now, key, verify_all)
    if args.command == "preflight":
        archive.preflight()
        print(json.dumps({"status": "preflight_ok", "data_region": config["data_region"],
                          "remote_bytes_not_yet_verified": True}))
        return
    if args.command == "verify":
        if not args.output or not args.manifest_key or not args.manifest_version:
            raise backup.BackupError("Verify richiede output, chiave e versione del manifest")
        directory = Path(args.output)
        directory.mkdir(mode=0o700, parents=True, exist_ok=False)
        print(json.dumps({"verified_files": verify_manifest(archive, args.manifest_key, args.manifest_version, directory,
                                                           config.get("storage_workers", 1))}))
        return
    def capture_snapshot():
        import psycopg
        from psycopg.rows import dict_row
        options = backup.connection_options(secret.get("database", {}), config["project_ref"])
        with tempfile.TemporaryDirectory(prefix="mirox-backup-") as tmp:
            with psycopg.connect(**options, autocommit=True, row_factory=dict_row) as connection:
                locked = connection.execute("SELECT pg_try_advisory_lock(72406392841004) AS locked").fetchone()["locked"]
                if not locked:
                    raise backup.BackupError("Un altro backup sta gia lavorando")
                result = backup.capture(config, secret, archive, connection, Path(tmp), verify_all)
        return result
    result = run_monitored(secret.get("monitor_url"), capture_snapshot)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        message = str(error) if isinstance(error, backup.BackupError) else "Errore del provider o della connessione"
        print(json.dumps({"status": "failed", "reason": message}), flush=True)
        raise SystemExit(1)
