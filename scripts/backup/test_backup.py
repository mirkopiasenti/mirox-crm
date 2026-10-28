import base64
import copy
import datetime as dt
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

import backup

HERE = Path(__file__).parent
CONFIG = json.loads((HERE / "config.json").read_text())
NOW = dt.datetime(2026, 10, 4, 2, 17, tzinfo=backup.UTC)
SECRET = {"database": {"host": "db.lbgwamhjkjjfwgusafbi.supabase.co", "user": "postgres", "password": "fixture"},
          "storage_key": "fixture"}
ROW = {"id": "object1", "bucket_id": "contratti-vendita", "name": "cliente/documento.pdf",
       "updated_at": "2026-10-04T00:00:00Z", "metadata": {"size": 3}}


class Missing(Exception):
    response = {"Error": {"Code": "404"}}


class S3:
    def __init__(self):
        self.objects = {}
        self.writes = []
        self.retention_updates = []
    def get_bucket_location(self, **kw):
        return {"LocationConstraint": "eu-central-1"}
    def get_bucket_versioning(self, **kw):
        return {"Status": "Enabled"}
    def get_object_lock_configuration(self, **kw):
        return {"ObjectLockConfiguration": {"ObjectLockEnabled": "Enabled"}}
    def get_public_access_block(self, **kw):
        return {"PublicAccessBlockConfiguration": {k: True for k in
                ("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")}}
    def get_bucket_encryption(self, **kw):
        return {"ServerSideEncryptionConfiguration": {"Rules": [{}]}}
    def head_object(self, **kw):
        if kw["Key"] not in self.objects:
            raise Missing()
        return self.objects[kw["Key"]][0].copy()
    def put_object(self, **kw):
        body = kw["Body"].read()
        checksum = base64.b64encode(hashlib.sha256(body).digest()).decode()
        if checksum != kw["ChecksumSHA256"]:
            raise RuntimeError("upload checksum failed")
        self.writes.append(kw["Key"])
        version = str(len(self.writes))
        head = {"Metadata": kw["Metadata"], "ChecksumSHA256": checksum,
                "VersionId": version, "ContentLength": len(body),
                "ObjectLockMode": kw["ObjectLockMode"], "ObjectLockRetainUntilDate": kw["ObjectLockRetainUntilDate"]}
        self.objects[kw["Key"]] = head, body
        return {"VersionId": version}
    def put_object_retention(self, **kw):
        self.retention_updates.append(kw)
        self.objects[kw["Key"]][0]["ObjectLockRetainUntilDate"] = kw["Retention"]["RetainUntilDate"]
    def get_object(self, **kw):
        head, body = self.objects[kw["Key"]]
        if kw["VersionId"] != head["VersionId"]:
            raise Missing()
        return dict(head, Body=io.BytesIO(body))


def fake_capture(connection, options, work):
    (work / "database.dump").write_bytes(b"fixture DB")
    (work / "roles.sql").write_bytes(b"fixture roles")
    return [{"id": name} for name in CONFIG["minimum_buckets"]], [ROW.copy()], 0


def fake_download(project, token, row, path):
    path.write_bytes(b"PDF")


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.work = Path(self.tmp.name)
        self.cwd = Path.cwd()
        os.chdir(self.work)
        self.s3 = S3()
        self.archive = backup.Archive(self.s3, "fixture", NOW)
    def tearDown(self):
        os.chdir(self.cwd)
        self.tmp.cleanup()
    def capture(self, **kw):
        with patch.object(backup, "capture_database", side_effect=fake_capture), patch.object(backup, "stable_source", return_value=True):
            return backup.capture(CONFIG, SECRET, self.archive, None, self.work, downloader=fake_download, **kw)
    def test_partial_download_never_commits_complete_manifest(self):
        def fail(*args):
            raise backup.BackupError("fixture failure")
        with patch.object(backup, "capture_database", side_effect=fake_capture):
            with self.assertRaises(backup.BackupError):
                backup.capture(CONFIG, SECRET, self.archive, None, self.work, downloader=fail)
        self.assertFalse(any(k.endswith("manifest.json.gz") for k in self.s3.writes))
    def test_changed_file_never_commits_complete_manifest(self):
        with patch.object(backup, "capture_database", side_effect=fake_capture), patch.object(backup, "stable_source", return_value=False):
            with self.assertRaises(backup.BackupError):
                backup.capture(CONFIG, SECRET, self.archive, None, self.work, downloader=fake_download)
        self.assertFalse(any(k.endswith("manifest.json.gz") for k in self.s3.writes))
    def test_dump_error_never_commits(self):
        with patch.object(backup, "capture_database", side_effect=backup.BackupError("export failure")):
            with self.assertRaises(backup.BackupError):
                backup.capture(CONFIG, SECRET, self.archive, None, self.work)
        self.assertEqual(self.s3.writes, [])
    def test_manifest_is_last_and_roundtrip_checks_every_byte(self):
        result = self.capture()
        self.assertTrue(self.s3.writes[-1].endswith("manifest.json.gz"))
        output = self.work / "verified"
        output.mkdir()
        ref = result["manifest"]
        self.assertEqual(backup.verify_manifest(self.s3, "fixture", ref["key"], ref["version_id"], output), 4)
    def test_restore_verification_detects_corruption(self):
        result = self.capture()
        key = backup.revision_key(CONFIG["project_ref"], ROW)
        head, _ = self.s3.objects[key]
        self.s3.objects[key] = head, b"BAD"
        ref = result["manifest"]
        with self.assertRaises(backup.BackupError):
            backup.verify_manifest(self.s3, "fixture", ref["key"], ref["version_id"], self.work)
    def test_reuses_immutable_versions_without_source_download(self):
        self.capture()
        key = backup.revision_key(CONFIG["project_ref"], ROW)
        original = self.s3.objects[key][0]["VersionId"]
        with patch.object(backup, "capture_database", side_effect=fake_capture):
            def fail(*args):
                raise AssertionError("Source should not be downloaded")
            backup.capture(CONFIG, SECRET, self.archive, None, self.work, downloader=fail)
        self.assertEqual(self.s3.objects[key][0]["VersionId"], original)
    def test_nightly_verification_rejects_same_revision_with_different_content(self):
        self.capture()
        def changed(project, token, row, path):
            path.write_bytes(b"NEW")
        before = len([k for k in self.s3.writes if k.endswith("manifest.json.gz")])
        with patch.object(backup, "capture_database", side_effect=fake_capture), patch.object(backup, "stable_source", return_value=True):
            with self.assertRaises(backup.BackupError):
                backup.capture(CONFIG, SECRET, self.archive, None, self.work, full_verify=True, downloader=changed)
        self.assertEqual(before, len([k for k in self.s3.writes if k.endswith("manifest.json.gz")]))
    def test_retention_extended_before_old_attachment_is_referenced_again(self):
        self.capture()
        key = backup.revision_key(CONFIG["project_ref"], ROW)
        self.s3.objects[key][0]["ObjectLockRetainUntilDate"] = NOW + dt.timedelta(days=90)
        self.capture()
        self.assertEqual(len(self.s3.retention_updates), 1)
        self.assertEqual(self.s3.retention_updates[0]["Retention"]["RetainUntilDate"], NOW + dt.timedelta(days=120))
    def test_missing_bucket_blocks_snapshot(self):
        def missing(connection, options, work):
            buckets, rows, n = fake_capture(connection, options, work)
            return buckets[1:], rows, n
        with patch.object(backup, "capture_database", side_effect=missing):
            with self.assertRaises(backup.BackupError):
                backup.capture(CONFIG, SECRET, self.archive, None, self.work)
        self.assertEqual(self.s3.writes, [])
    def test_vault_without_recovery_key_blocks_snapshot(self):
        def vault(connection, options, work):
            buckets, rows, _ = fake_capture(connection, options, work)
            return buckets, rows, 1
        with patch.object(backup, "capture_database", side_effect=vault):
            with self.assertRaises(backup.BackupError):
                backup.capture(CONFIG, SECRET, self.archive, None, self.work)
        self.assertEqual(self.s3.writes, [])
    def test_wrong_project_and_transaction_pooler_rejected(self):
        with self.assertRaises(backup.BackupError):
            backup.connection_options(dict(SECRET["database"], host="db.other.supabase.co"), CONFIG["project_ref"])
        with self.assertRaises(backup.BackupError):
            backup.connection_options(dict(SECRET["database"], port=6543), CONFIG["project_ref"])
    def test_parallelism_is_bounded_and_rejects_non_integer_values(self):
        for workers in (0, 9, True, "4", 1.5):
            with self.assertRaises(backup.BackupError):
                backup.validate_snapshot_config(dict(CONFIG, storage_workers=workers))
        for workers in (1, 8):
            backup.validate_snapshot_config(dict(CONFIG, storage_workers=workers))
    def test_nightly_hour_rejects_invalid_configuration(self):
        for hour in (-1, 24, True, "3"):
            with self.assertRaises(backup.BackupError):
                backup.validate_snapshot_config(dict(CONFIG, nightly_hour_utc=hour))
    def test_nightly_hour_moves_weekly_daily_retention_together(self):
        config = dict(CONFIG, nightly_hour_utc=3)
        self.assertEqual(backup.retention_days(config, NOW), 2)
        self.assertEqual(backup.retention_days(config, NOW + dt.timedelta(hours=1)), 90)
        self.assertEqual(backup.retention_days(config, NOW + dt.timedelta(days=1, hours=1)), 30)
    def test_storage_not_found_is_distinct_from_authentication_failure(self):
        error = urllib.error.HTTPError("https://fixture", 400, "fixture", {},
                  io.BytesIO(b'{"statusCode":"404","error":"not_found"}'))
        with patch("urllib.request.OpenerDirector.open", side_effect=error):
            with self.assertRaises(backup.SourceNotFound):
                backup.download_source(CONFIG["project_ref"], "fixture", ROW, self.work / "missing.bin")
    def test_storage_unauthorized_cannot_trigger_duplicate_recovery(self):
        error = urllib.error.HTTPError("https://fixture", 400, "fixture", {},
                  io.BytesIO(b'{"statusCode":"403","error":"Unauthorized"}'))
        with patch("urllib.request.OpenerDirector.open", side_effect=error):
            with self.assertRaises(backup.BackupError) as caught:
                backup.download_source(CONFIG["project_ref"], "fixture", ROW, self.work / "denied.bin")
        self.assertNotIsInstance(caught.exception, backup.SourceNotFound)
    def test_connection_password_never_appears_in_arguments(self):
        options = backup.connection_options(SECRET["database"], CONFIG["project_ref"])
        env = backup.pg_environment(options)
        self.assertEqual(env["PGPASSWORD"], "fixture")
        self.assertEqual(env["PGSSLMODE"], "verify-full")
        self.assertIn("default_transaction_read_only=on", env["PGOPTIONS"])
    def test_database_ca_is_forwarded_without_weakening_tls(self):
        database = dict(SECRET["database"], sslrootcert="/opt/mirox-backup/certs/supabase-ca.crt")
        options = backup.connection_options(database, CONFIG["project_ref"])
        env = backup.pg_environment(options)
        self.assertEqual(env["PGSSLROOTCERT"], database["sslrootcert"])
        self.assertEqual(env["PGSSLMODE"], "verify-full")
        for invalid in ["relative.crt", "", None]:
            with self.subTest(invalid=invalid), self.assertRaises(backup.BackupError):
                backup.connection_options(dict(database, sslrootcert=invalid), CONFIG["project_ref"])
    def test_unversioned_or_unprotected_archive_rejected(self):
        with patch.object(self.s3, "get_bucket_versioning", return_value={}):
            with self.assertRaises(backup.BackupError):
                self.archive.preflight()
        with patch.object(self.s3, "get_public_access_block", return_value={}):
            with self.assertRaises(backup.BackupError):
                self.archive.preflight()
    def test_missing_s3_integrity_rejected(self):
        self.capture()
        head = self.s3.objects[backup.revision_key(CONFIG["project_ref"], ROW)][0].copy()
        head.pop("ChecksumSHA256")
        with self.assertRaises(backup.BackupError):
            self.archive.reference("fixture", head, 120)
    def test_revision_keys_preserve_changed_versions_without_customer_names(self):
        one = backup.revision_key(CONFIG["project_ref"], ROW)
        two = backup.revision_key(CONFIG["project_ref"], dict(ROW, updated_at="later"))
        self.assertNotEqual(one, two)
        self.assertNotIn("cliente", one)
        self.assertNotIn("documento", one)
    def test_retention_tiers_and_dependency_margin(self):
        self.assertEqual(backup.retention_days(CONFIG, NOW), 90)
        self.assertEqual(backup.retention_days(CONFIG, NOW + dt.timedelta(days=1)), 30)
        self.assertEqual(backup.retention_days(CONFIG, NOW + dt.timedelta(hours=1)), 2)
        with self.assertRaises(backup.BackupError):
            backup.validate_config(dict(CONFIG, object_days=91))
    def test_missing_auth_data_in_dump_blocks_snapshot(self):
        connection = unittest.mock.Mock()
        connection.execute.return_value.fetchone.side_effect = [{"snapshot": "fixture"}, {"n": 0}]
        connection.execute.return_value.fetchall.side_effect = [[], []]
        with patch.object(backup, "run_tool", side_effect=[b"", b"TABLE DATA public profili postgres"]):
            with self.assertRaises(backup.BackupError):
                backup.capture_database(connection, backup.connection_options(SECRET["database"], CONFIG["project_ref"]), self.work)
    def test_provider_error_details_not_exposed_by_tool_export(self):
        result = unittest.mock.Mock(returncode=1, stdout=b"", stderr=b"password=secret customer-name")
        with patch.object(backup.subprocess, "run", return_value=result):
            with self.assertRaises(backup.BackupError) as error:
                backup.run_tool(["pg_dump"], {})
        self.assertNotIn("secret", str(error.exception))
    def test_public_repository_bundle_without_credentials(self):
        def git_tool(args, env, output=None):
            self.assertEqual(env["GIT_TERMINAL_PROMPT"], "0")
            self.assertNotIn("BACKUP_GITHUB_TOKEN", env)
            self.assertNotIn("GIT_ASKPASS", env)
            if "clone" in args:
                Path(args[-1]).mkdir()
            else:
                Path(args[-3]).write_bytes(b"git-bundle-fixture")
            return b""
        with patch.object(backup, "run_tool", side_effect=git_tool):
            refs, covered = backup.capture_repositories({"repositories":["https://github.com/owner/project.git"]}, self.archive, self.work, CONFIG["project_ref"], 120)
        self.assertTrue(covered)
        self.assertEqual(len(refs), 1)
        self.assertTrue(refs[0]["archive"]["key"].endswith(".bundle"))
    def test_unreadable_repository_does_not_commit_manifest(self):
        secret = dict(SECRET, repositories=["https://github.com/owner/private.git"])
        with patch.object(backup, "capture_database", side_effect=fake_capture), patch.object(backup, "stable_source", return_value=True), patch.object(backup, "run_tool", side_effect=backup.BackupError("Repository non accessibile")):
            with self.assertRaises(backup.BackupError):
                backup.capture(CONFIG, secret, self.archive, None, self.work, downloader=fake_download)
        self.assertFalse(any(key.endswith("manifest.json.gz") for key in self.s3.writes))


class InfrastructureTests(unittest.TestCase):
    def test_role_has_explicit_delete_and_bypass_denial(self):
        stack = json.loads((HERE / "aws-stack.json").read_text())
        statements = stack["Resources"]["RunnerRole"]["Properties"]["Policies"][0]["PolicyDocument"]["Statement"]
        denial = next(s for s in statements if s["Effect"] == "Deny")
        self.assertEqual(set(denial["Action"]), {"s3:DeleteObject", "s3:DeleteObjectVersion", "s3:BypassGovernanceRetention"})
        self.assertEqual(stack["Parameters"]["ScheduleState"]["Default"], "DISABLED")
        self.assertEqual(stack["Resources"]["BackupBucket"]["DeletionPolicy"], "Retain")
    def test_dependency_lock_covers_direct_and_transitive_packages_with_hashes(self):
        lines = [s for s in (HERE / "requirements.lock").read_text().splitlines() if s and not s.startswith("#")]
        self.assertGreaterEqual(len(lines), 10)
        for line in lines:
            self.assertRegex(line, r"^[-A-Za-z0-9_]+==[0-9.]+[^ ]* --hash=sha256:[a-f0-9]{64}$")


if __name__ == "__main__":
    unittest.main()
