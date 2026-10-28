import base64
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
import stat
import threading
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import aruba
import backup
from test_backup import CONFIG, NOW, SECRET, ROW, fake_capture, fake_download

HERE = Path(__file__).parent
ARUBA_CONFIG = json.loads((HERE / "aruba-config.json").read_text())
KEY = bytes(range(32))


class MissingPolicy(Exception):
    response = {"Error": {"Code": "NoSuchBucketPolicy"}}


class S3:
    def __init__(self):
        self.objects, self.writes, self.retention_updates = {}, [], []
    def get_bucket_versioning(self, **kw):
        return {"Status": "Enabled"}
    def get_object_lock_configuration(self, **kw):
        return {"ObjectLockConfiguration": {"ObjectLockEnabled": "Enabled"}}
    def get_bucket_acl(self, **kw):
        return {"Owner": {"ID": "owner"}, "Grants": [{"Grantee": {"Type": "CanonicalUser", "ID": "owner"}, "Permission": "FULL_CONTROL"}]}
    def get_bucket_policy(self, **kw):
        raise MissingPolicy()
    def put_object(self, **kw):
        body = kw["Body"].read()
        assert kw["ContentMD5"] == base64.b64encode(hashlib.md5(body, usedforsecurity=False).digest()).decode()
        assert kw["ACL"] == "private"
        self.writes.append(kw["Key"])
        version = str(len(self.writes))
        head = {"Metadata": kw["Metadata"].copy(), "ContentLength": len(body), "VersionId": version}
        retention = {"Mode": kw["ObjectLockMode"], "RetainUntilDate": kw["ObjectLockRetainUntilDate"]}
        self.objects[kw["Key"]] = head, body, retention
        return {"VersionId": version}
    def head_object(self, **kw):
        if kw["Key"] not in self.objects:
            from test_backup import Missing
            raise Missing()
        return self.objects[kw["Key"]][0].copy()
    def get_object(self, **kw):
        head, body, _ = self.objects[kw["Key"]]
        assert kw["VersionId"] == head["VersionId"]
        return dict(head, Body=io.BytesIO(body))
    def get_object_retention(self, **kw):
        assert kw["VersionId"] == self.objects[kw["Key"]][0]["VersionId"]
        return {"Retention": self.objects[kw["Key"]][2].copy()}
    def put_object_retention(self, **kw):
        self.retention_updates.append(kw)
        self.objects[kw["Key"]][2].update(kw["Retention"])


@unittest.skipUnless(importlib.util.find_spec("cryptography"), "Installare requirements-aruba.lock per i test cifratura")
class ArubaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.work = Path(self.tmp.name)
        self.cwd = Path.cwd()
        os.chdir(self.work)
        self.s3 = S3()
        self.archive = aruba.Archive(self.s3, "fixture", NOW, KEY)
    def tearDown(self):
        os.chdir(self.cwd)
        self.tmp.cleanup()
    def capture(self, **kw):
        with patch.object(backup, "capture_database", side_effect=fake_capture), patch.object(backup, "stable_source", return_value=True):
            return backup.capture(ARUBA_CONFIG, SECRET, self.archive, None, self.work, downloader=fake_download, **kw)
    def test_whole_capture_encrypted_and_all_files_recoverable(self):
        result = self.capture()
        self.assertTrue(self.s3.writes[-1].endswith("manifest.json.gz"))
        for _, body, retention in self.s3.objects.values():
            self.assertTrue(body.startswith(aruba.MAGIC))
            self.assertNotIn(b"fixture DB", body)
            self.assertEqual(retention["Mode"], "COMPLIANCE")
        output = self.work / "verify"
        output.mkdir()
        ref = result["manifest"]
        self.assertEqual(aruba.verify_manifest(self.archive, ref["key"], ref["version_id"], output), 4)
        self.assertEqual((output / "00000000.bin").read_bytes(), b"PDF")
    def test_parallel_capture_keeps_each_file_and_manifest_mapping_separate(self):
        rows = [dict(ROW, id=str(i), name=str(i) + ".pdf") for i in range(4)]
        barrier = threading.Barrier(4, timeout=5)
        paths = []
        def inventory(connection, options, work):
            buckets, _, vault = fake_capture(connection, options, work)
            return buckets, rows, vault
        def download(project, token, row, path):
            paths.append(path)
            path.write_bytes(row["id"].encode() * 3)
            barrier.wait()
        with patch.object(backup, "capture_database", side_effect=inventory), patch.object(backup, "stable_source", return_value=True):
            result = backup.capture(dict(ARUBA_CONFIG, storage_workers=4), SECRET, self.archive, None,
                                    self.work, downloader=download)
        self.assertEqual(len(set(paths)), 4)
        output = self.work / "parallel-verify"
        output.mkdir()
        ref = result["manifest"]
        self.assertEqual(aruba.verify_manifest(self.archive, ref["key"], ref["version_id"], output, workers=4), 7)
        for i in range(4):
            self.assertEqual((output / f"{i:08d}.bin").read_bytes(), str(i).encode() * 3)
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual([r["source"]["id"] for r in manifest["objects"]], [str(i) for i in range(4)])
        self.assertTrue(self.s3.writes[-1].endswith("manifest.json.gz"))
    def test_parallel_failure_never_commits_manifest(self):
        rows = [dict(ROW, id=str(i), name=str(i) + ".pdf") for i in range(4)]
        barrier = threading.Barrier(4, timeout=5)
        def inventory(connection, options, work):
            buckets, _, vault = fake_capture(connection, options, work)
            return buckets, rows, vault
        def download(project, token, row, path):
            path.write_bytes(b"PDF")
            barrier.wait()
            if row["id"] == "2":
                raise backup.BackupError("fixture failure")
        with patch.object(backup, "capture_database", side_effect=inventory), patch.object(backup, "stable_source", return_value=True):
            with self.assertRaises(backup.BackupError):
                backup.capture(dict(ARUBA_CONFIG, storage_workers=4), SECRET, self.archive, None,
                               self.work, downloader=download)
        self.assertFalse(any(k.endswith("manifest.json.gz") for k in self.s3.writes))
    def duplicate_capture(self, content=b"PDF", etag=None, stable=True):
        md5 = hashlib.md5(b"PDF", usedforsecurity=False).digest()
        etag = etag or hashlib.md5(md5, usedforsecurity=False).hexdigest() + "-1"
        rows = [dict(ROW, id="missing", name="missing.pdf", metadata={"size": 3, "eTag": etag}),
                dict(ROW, id="copy", name="copy.pdf", metadata={"size": 3, "eTag": etag})]
        def inventory(connection, options, work):
            buckets, _, vault = fake_capture(connection, options, work)
            return buckets, rows, vault
        def download(project, token, row, path):
            if row["id"] == "missing":
                raise backup.SourceNotFound("fixture missing")
            path.write_bytes(content)
        with patch.object(backup, "capture_database", side_effect=inventory), patch.object(backup, "stable_source", return_value=stable):
            return backup.capture(ARUBA_CONFIG, SECRET, self.archive, None, self.work, downloader=download)
    def test_missing_source_recovered_from_duplicate_with_original_checksum(self):
        result = self.duplicate_capture()
        self.assertEqual(result["recovered_from_duplicates"], 1)
        output = self.work / "duplicate-verify"
        output.mkdir()
        ref = result["manifest"]
        self.assertEqual(aruba.verify_manifest(self.archive, ref["key"], ref["version_id"], output, workers=4), 5)
        self.assertEqual((output / "00000000.bin").read_bytes(), b"PDF")
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual(manifest["objects"][0]["source"]["id"], "missing")
        self.assertEqual(manifest["objects"][0]["recovered_from_duplicate"], "copy")
        # Anche il controllo notturno ricostruisce e confronta il file originale.
        self.archive.verify_reused = True
        self.duplicate_capture()
    def test_duplicate_with_wrong_bytes_never_commits(self):
        with self.assertRaises(backup.SourceNotFound):
            self.duplicate_capture(content=b"BAD")
        self.assertFalse(any(k.endswith("manifest.json.gz") for k in self.s3.writes))
    def test_ambiguous_multipart_duplicate_never_commits(self):
        with self.assertRaises(backup.SourceNotFound):
            self.duplicate_capture(etag="0" * 32 + "-2")
        self.assertFalse(any(k.endswith("manifest.json.gz") for k in self.s3.writes))
    def test_changed_duplicate_never_commits(self):
        with self.assertRaises(backup.BackupError):
            self.duplicate_capture(stable=False)
        self.assertFalse(any(k.endswith("manifest.json.gz") for k in self.s3.writes))
    def test_local_code_package_is_encrypted_and_recoverable(self):
        (self.work / "recovery-source.zip").write_bytes(b"fixture local code")
        result = self.capture()
        output = self.work / "verify-code"
        output.mkdir()
        ref = result["manifest"]
        self.assertEqual(aruba.verify_manifest(self.archive, ref["key"], ref["version_id"], output), 5)
        self.assertIn(b"fixture local code", [p.read_bytes() for p in output.glob("*.bin")])
        for _, body, _ in self.s3.objects.values():
            self.assertNotIn(b"fixture local code", body)
    def test_ciphertext_corruption_detected_even_with_modified_checksum(self):
        result = self.capture()
        ref = result["manifest"]
        head, body, retention = self.s3.objects[ref["key"]]
        body = body[:-1] + bytes([body[-1] ^ 1])
        head["Metadata"]["cipher-sha256"] = hashlib.sha256(body).hexdigest()
        self.s3.objects[ref["key"]] = head, body, retention
        output = self.work / "bad"
        with self.assertRaises(backup.BackupError):
            self.archive.download(ref["key"], ref["version_id"], output)
        self.assertFalse(output.exists())
        self.assertFalse(Path(str(output) + ".unauthenticated").exists())
    def test_wrong_encryption_key_and_context_rejected(self):
        source, encrypted = self.work / "plain", self.work / "encrypted"
        source.write_bytes(b"sensitive")
        aruba.encrypt_file(source, encrypted, KEY, "object-a")
        for key, context in ((os.urandom(32), "object-a"), (KEY, "object-b")):
            with self.assertRaises(backup.BackupError):
                aruba.decrypt_file(encrypted, self.work / "wrong", key, context)
            self.assertFalse((self.work / "wrong").exists())
    def test_streaming_roundtrip_and_unique_nonce(self):
        source = self.work / "plain"
        content = os.urandom(2 * 1024 * 1024 + 13)
        source.write_bytes(content)
        one, two, recovered = self.work / "one", self.work / "two", self.work / "recovered"
        aruba.encrypt_file(source, one, KEY, "context")
        aruba.encrypt_file(source, two, KEY, "context")
        self.assertNotEqual(one.read_bytes(), two.read_bytes())
        aruba.decrypt_file(one, recovered, KEY, "context")
        self.assertEqual(recovered.read_bytes(), content)
    def test_reused_objects_keep_versions_and_extend_confirmed_retention(self):
        from test_backup import ROW
        self.capture()
        key = backup.revision_key(CONFIG["project_ref"], ROW)
        version = self.s3.objects[key][0]["VersionId"]
        self.s3.objects[key][2]["RetainUntilDate"] = NOW + dt.timedelta(days=90)
        self.capture()
        self.assertEqual(self.s3.objects[key][0]["VersionId"], version)
        self.assertEqual(self.s3.retention_updates[0]["Retention"]["RetainUntilDate"], NOW + dt.timedelta(days=120))
    def test_unconfirmed_extension_and_governance_block_new_manifest(self):
        from test_backup import ROW
        self.capture()
        key = backup.revision_key(CONFIG["project_ref"], ROW)
        self.s3.objects[key][2]["RetainUntilDate"] = NOW + dt.timedelta(days=90)
        before = len(self.s3.writes)
        with patch.object(self.s3, "put_object_retention", return_value={}):
            with self.assertRaises(backup.BackupError):
                self.capture()
        self.assertEqual(len(self.s3.writes), before)
        self.s3.objects[key][2]["Mode"] = "GOVERNANCE"
        with self.assertRaises(backup.BackupError):
            self.capture()
    def test_readback_failure_never_commits_manifest(self):
        with patch.object(self.s3, "get_object", side_effect=RuntimeError("fixture failure")):
            with self.assertRaises(RuntimeError):
                self.capture()
        self.assertFalse(any(k.endswith("manifest.json.gz") for k in self.s3.writes))
    def test_nightly_detects_corruption_in_cached_archive_bytes(self):
        from test_backup import ROW
        self.capture()
        key = backup.revision_key(CONFIG["project_ref"], ROW)
        head, body, retention = self.s3.objects[key]
        self.s3.objects[key] = head, body[:-1] + bytes([body[-1] ^ 1]), retention
        self.archive.verify_reused = True
        self.archive.verified_versions.clear()
        before = len(self.s3.writes)
        with self.assertRaises(backup.BackupError):
            self.capture(full_verify=True)
        self.assertEqual(len(self.s3.writes), before)
    def test_key_rotation_without_migration_rejected(self):
        from test_backup import ROW
        self.capture()
        key = backup.revision_key(CONFIG["project_ref"], ROW)
        other = aruba.Archive(self.s3, "fixture", NOW, os.urandom(32))
        with self.assertRaises(backup.BackupError):
            other.reference(key, other.head(key), 120)


class ConfigurationTests(unittest.TestCase):
    def test_success_ping_only_after_commit(self):
        events = []
        def committed():
            events.append("commit")
            return {"fixture": True}
        with patch.object(aruba, "notify", side_effect=lambda url, status: events.append(status)):
            self.assertTrue(aruba.run_monitored("fixture", committed)["fixture"])
        self.assertEqual(events, ["start", "commit", "complete"])
    def test_failed_capture_never_pings_success(self):
        with patch.object(aruba, "notify") as notify:
            with self.assertRaises(backup.BackupError):
                aruba.run_monitored("fixture", unittest.mock.Mock(side_effect=backup.BackupError("export failed")))
        self.assertEqual([call.args[1] for call in notify.call_args_list], ["start", "failed"])
    def test_unreachable_monitor_blocks_execution(self):
        capture = unittest.mock.Mock()
        with patch.object(aruba, "notify", side_effect=backup.BackupError("offline")):
            with self.assertRaises(backup.BackupError):
                aruba.run_monitored("fixture", capture)
        capture.assert_not_called()
    def test_failure_to_notify_does_not_mask_original_error(self):
        def notify(url, status):
            if status == "failed":
                raise backup.BackupError("offline")
        with patch.object(aruba, "notify", side_effect=notify):
            with self.assertRaisesRegex(backup.BackupError, "export failed"):
                aruba.run_monitored("fixture", unittest.mock.Mock(side_effect=backup.BackupError("export failed")))
    def test_only_official_italian_endpoints_accepted(self):
        aruba.validate_config(ARUBA_CONFIG)
        for endpoint in ("http://r1-it.storage.cloud.it", "https://r1-it.storage.cloud.it.evil.test", "https://r1-fr.storage.arubacloud.fr"):
            with self.assertRaises(backup.BackupError):
                aruba.validate_config(dict(ARUBA_CONFIG, endpoint_url=endpoint))
    def test_private_secret_permissions_and_symlink_checked(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "secret.json"
            path.write_text('{"fixture": true}')
            path.chmod(0o600)
            self.assertTrue(aruba.load_secret(path)["fixture"])
            path.chmod(0o644)
            with self.assertRaises(backup.BackupError):
                aruba.load_secret(path)
            link = Path(tmp) / "link"
            link.symlink_to(path)
            with self.assertRaises(OSError):
                aruba.load_secret(link)
    def test_systemd_credentials_require_private_readonly_mount(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "fixture.json"
            fixture.write_text('{"fixture": true}')
            original_open = os.open
            directory = "/run/credentials/mirox-backup.service"
            file_info = unittest.mock.Mock(st_uid=0, st_gid=0, st_mode=stat.S_IFREG | 0o440)
            parent_info = unittest.mock.Mock(st_uid=0, st_gid=0, st_mode=stat.S_IFDIR | 0o550)
            filesystem = unittest.mock.Mock(f_flag=os.ST_RDONLY)
            with patch.dict(os.environ, {"CREDENTIALS_DIRECTORY":directory}), patch.object(aruba.os, "open", side_effect=lambda *a: original_open(fixture, os.O_RDONLY)), patch.object(aruba.os, "fstat", return_value=file_info), patch.object(aruba.os, "geteuid", return_value=999), patch.object(aruba.Path, "stat", return_value=parent_info), patch.object(aruba.os, "fstatvfs", return_value=filesystem):
                path = directory + "/private.json"
                self.assertTrue(aruba.load_secret(path)["fixture"])
                for mode in (0o444, 0o460):
                    file_info.st_mode = stat.S_IFREG | mode
                    with self.assertRaises(backup.BackupError): aruba.load_secret(path)
                file_info.st_mode = stat.S_IFREG | 0o440
                filesystem.f_flag = 0
                with self.assertRaises(backup.BackupError): aruba.load_secret(path)
                filesystem.f_flag = os.ST_RDONLY
                parent_info.st_mode = stat.S_IFDIR | 0o770
                with self.assertRaises(backup.BackupError): aruba.load_secret(path)
                parent_info.st_mode = stat.S_IFDIR | 0o550
                with self.assertRaises(backup.BackupError): aruba.load_secret(directory + "/other.json")
                with patch.dict(os.environ, {"CREDENTIALS_DIRECTORY":"/tmp/credentials"}):
                    with self.assertRaises(backup.BackupError): aruba.load_secret("/tmp/credentials/private.json")
    def test_public_or_shared_bucket_rejected(self):
        s3 = S3()
        archive = aruba.Archive(s3, "fixture", NOW, KEY)
        public = {"Owner": {"ID": "owner"}, "Grants": [{"Grantee": {"Type": "Group", "URI": "AllUsers"}}]}
        with patch.object(s3, "get_bucket_acl", return_value=public):
            with self.assertRaises(backup.BackupError):
                archive.preflight()
        with patch.object(s3, "get_bucket_policy", return_value={"Policy": '{"Statement": []}'}):
            with self.assertRaises(backup.BackupError):
                archive.preflight()
    def test_unsupported_private_check_fails_closed(self):
        s3 = S3()
        archive = aruba.Archive(s3, "fixture", NOW, KEY)
        with patch.object(s3, "get_bucket_policy", side_effect=RuntimeError("unsupported")):
            with self.assertRaises(RuntimeError):
                archive.preflight()
    def test_monitor_failure_not_marked_as_success_and_no_payload_sent(self):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.status = 200
        opener = unittest.mock.Mock()
        opener.open.return_value = response
        with patch.object(aruba.urllib.request, "build_opener", return_value=opener):
            aruba.notify("https://hc-ping.com/00000000-0000-0000-0000-000000000000", "complete")
        request = opener.open.call_args.args[0]
        self.assertEqual(request.data, b"")
        self.assertEqual(request.get_method(), "POST")
        with self.assertRaises(backup.BackupError):
            aruba.notify("https://other.example/token", "complete")
    def test_invalid_encryption_key_rejected(self):
        with self.assertRaises(backup.BackupError):
            aruba.encryption_key({"archive": {"encryption_key_b64": "not base64"}})
    def test_lifecycle_has_dependency_margin_and_no_delete_in_runner(self):
        rules = json.loads((HERE / "aruba-lifecycle.json").read_text())["Rules"]
        for rule in rules:
            days = int(rule["Filter"]["Tag"]["Value"])
            self.assertGreater(rule["Expiration"]["Days"], days)
            self.assertGreater(rule["NoncurrentVersionExpiration"]["NoncurrentDays"], days)
        self.assertNotIn("delete_object(", (HERE / "aruba.py").read_text())
    def test_aruba_lock_covers_pinned_crypto_wheels(self):
        lines = (HERE / "requirements-aruba.lock").read_text().splitlines()
        self.assertIn("-r requirements.lock", lines)
        packages = [line for line in lines if line and not line.startswith(("#", "-r"))]
        self.assertEqual(len(packages), 3)
        for line in packages:
            self.assertRegex(line, r"^[-A-Za-z0-9_]+==[0-9.]+ --hash=sha256:[a-f0-9]{64}$")


if __name__ == "__main__":
    unittest.main()
