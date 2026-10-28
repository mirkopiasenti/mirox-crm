#!/usr/bin/env python3
"""Pacchetto di attivazione locale; nessuna lettura di .env o dati cliente."""
import os
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / ".backup-private"
RUNNER_FILES = (
    "backup.py", "aruba.py", "package.py", "test_backup.py", "test_aruba.py",
    "config.json", "secret.example.json", "aws-stack.json", "buildspec.yml",
    "requirements.txt", "requirements.lock", "requirements-aruba.txt", "requirements-aruba.lock",
    "aruba-config.json", "aruba-secret.example.json", "aruba-lifecycle.json",
    "mirox-backup.service", "mirox-backup.timer",
    "provision-aruba.sh", "restore-local.py", "maintenance.py", "test_maintenance.py",
    "audit.py", "test_audit.py", "mirox-backup-audit.service", "mirox-backup-audit.timer",
)


def main():
    os.umask(0o077)
    OUTPUT.mkdir(mode=0o700, exist_ok=True)
    bundle = OUTPUT / "mirox-local.bundle"
    # Git bundle contiene tutti i ref locali, inclusi i branch non integrati.
    subprocess.run(["git", "-C", str(ROOT), "bundle", "create", str(bundle), "--all", "--quiet"], check=True)
    tracked = subprocess.check_output(["git", "-C", str(ROOT), "ls-files", "-z"]).split(b"\0")
    recovery = OUTPUT / "recovery-source.zip"
    with zipfile.ZipFile(recovery, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(bundle, "mirox-local.bundle")
        for raw in tracked:
            if not raw:
                continue
            relative = Path(os.fsdecode(raw))
            path = ROOT / relative
            if path.is_file() and not path.is_symlink():
                archive.write(path, "working-tree/" + relative.as_posix())
        # Nuovi file di questo intervento, ancora non presenti nell'indice Git.
        for filename in RUNNER_FILES:
            path = ROOT / "scripts/backup" / filename
            name = "working-tree/" + path.relative_to(ROOT).as_posix()
            if name not in archive.namelist():
                archive.write(path, name)
        for name in ("docs/BACKUP_RIPRISTINO.md", "docs/STATO_LAVORO.md", "tests/backup.test.js"):
            path = ROOT / name
            if path.exists() and "working-tree/" + name not in archive.namelist():
                archive.write(path, "working-tree/" + name)
    with zipfile.ZipFile(OUTPUT / "runner.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for filename in RUNNER_FILES:
            path = ROOT / "scripts/backup" / filename
            archive.write(path, path.relative_to(ROOT).as_posix())
        archive.write(recovery, "recovery-source.zip")
    print("Pacchetto privato creato in .backup-private/runner.zip")


if __name__ == "__main__":
    main()
