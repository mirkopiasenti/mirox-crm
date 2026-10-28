#!/usr/bin/env python3
"""Collaudo del dump su PostgreSQL effimero, senza rete o volumi host.

Non accetta URL/credenziali Supabase, non ripristina produzione e non collauda
le API Auth/Storage. Confronta tutti i valori COPY, oltre a indici e vincoli.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

IMAGE = "supabase/postgres@sha256:95d92e9563121189086690a4b7f8f2b711a4809a2499f45592199aae68ebae5f"


def fingerprint(lines):
    return hashlib.sha256(b"".join(sorted(lines))).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dump", required=True)
    parser.add_argument("--roles", required=True)
    parser.add_argument("--work", required=True)
    args = parser.parse_args()
    dump, roles = Path(args.dump).resolve(), Path(args.roles).resolve()
    os.umask(0o077)
    work = Path(args.work).resolve()
    work.mkdir(mode=0o700, exist_ok=False)
    name = "mirox-restore-" + uuid.uuid4().hex
    started = False
    began = time.monotonic()
    log = open(work / "diagnostics.log", "ab")

    def run(command, data=None):
        result = subprocess.run(command, input=data, stdout=subprocess.PIPE,
                                stderr=log, timeout=600)
        if result.returncode:
            raise RuntimeError("Collaudo fallito; diagnostica nel file privato")
        return result.stdout

    def sql(statement):
        return run(["docker", "exec", name, "psql", "-X", "-q", "-A", "-t",
                    "-v", "ON_ERROR_STOP=1", "-h", "/tmp", "-U", "postgres",
                    "-d", "postgres", "-c", statement])

    try:
        raw = run(["pg_restore", "--data-only", "--file=-", str(dump)])
        tables, header, lines = {}, None, []
        for line in raw.splitlines(keepends=True):
            if header is None and line.startswith(b"COPY ") and line.rstrip().endswith(b" FROM stdin;"):
                header, lines = line.rstrip().decode("utf8"), []
            elif header is not None and line.rstrip() == b"\\.":
                if header in tables:
                    raise RuntimeError("COPY duplicato nel dump")
                tables[header] = (len(lines), fingerprint(lines))
                header = None
            elif header is not None:
                lines.append(line)
        if header or not tables:
            raise RuntimeError("Dump privo di blocchi COPY completi")
        toc = run(["pg_restore", "--list", str(dump)])
        entries = [line for line in toc.splitlines(keepends=True)
                   if b" SCHEMA - public " not in line]
        (work / "restore.list").write_bytes(b"".join(entries))
        init = ("initdb -D /restore-data --username=postgres --encoding=UTF8 --auth-local=trust "
                "--auth-host=reject --no-locale >/tmp/initdb.log 2>&1 && "
                "exec postgres -D /restore-data -c listen_addresses='' "
                "-c unix_socket_directories=/tmp "
                "-c shared_preload_libraries='pg_cron,pg_stat_statements' "
                "-c cron.database_name=postgres -c cron.launch_active_jobs=off")
        run(["docker", "run", "-d", "--name", name, "--network", "none",
             "--read-only", "--memory", "2g", "--cpus", "1", "--pids-limit", "128",
             "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
             "--user", "postgres", "--tmpfs", "/tmp:rw,nosuid,noexec,mode=1777",
             "--tmpfs", "/restore-data:rw,nosuid,uid=100,gid=101,mode=0700",
             "--entrypoint", "sh", IMAGE, "-c", init])
        started = True
        for _ in range(60):
            ready = subprocess.run(["docker", "exec", name, "pg_isready", "-h", "/tmp", "-U", "postgres"],
                                   stdout=subprocess.DEVNULL, stderr=log, timeout=10)
            if ready.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("Database isolato non avviato")
        isolation = json.loads(run(["docker", "inspect", name]))[0]
        if isolation["HostConfig"]["NetworkMode"] != "none" or isolation["HostConfig"]["PortBindings"]:
            raise RuntimeError("Isolamento container non verificato")
        if sql("SHOW cron.launch_active_jobs").strip() != b"off":
            raise RuntimeError("Cron non disattivato")
        # Solo definizioni dei ruoli: nessuna password e nessun LOGIN importato.
        for line in roles.read_text().splitlines():
            if line.startswith("CREATE ROLE ") and line != "CREATE ROLE postgres;":
                sql(line)
        run(["docker", "exec", "-i", name, "sh", "-c", "umask 077; cat >/tmp/database.dump"], dump.read_bytes())
        run(["docker", "exec", "-i", name, "sh", "-c", "umask 077; cat >/tmp/restore.list"], (work / "restore.list").read_bytes())
        run(["docker", "exec", name, "pg_restore", "--exit-on-error", "--single-transaction",
             "--no-owner", "--no-privileges", "--use-list=/tmp/restore.list",
             "--host=/tmp", "--username=postgres", "--dbname=postgres", "/tmp/database.dump"])
        for header, (count, digest) in tables.items():
            restored = sql(header.removesuffix(" FROM stdin;") + " TO stdout;").splitlines(keepends=True)
            if len(restored) != count or fingerprint(restored) != digest:
                raise RuntimeError("Valori restaurati diversi dal dump")
        result = {"status": "isolated_database_restore_verified", "tables": len(tables),
                  "rows": sum(item[0] for item in tables.values()),
                  "all_copy_values_match": True, "network": "none", "cron_jobs": "disabled",
                  "seconds": round(time.monotonic() - began, 1),
                  "auth_storage_api_tested": False, "production_acl_ownership_tested": False}
        (work / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result), flush=True)
    finally:
        if started:
            subprocess.run(["docker", "logs", name], stdout=log, stderr=log, timeout=30)
            subprocess.run(["docker", "rm", "-f", name], stdout=log, stderr=log, timeout=30)
        log.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status": "restore_test_failed", "error_type": type(error).__name__}), flush=True)
        raise SystemExit(1)
