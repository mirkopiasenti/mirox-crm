import io
import importlib.util
import tarfile
import unittest
from unittest.mock import patch

import backup
import maintenance
import test_aruba as fixtures


@unittest.skipUnless(importlib.util.find_spec("cryptography"), "Installare requirements-aruba.lock")
class IndependentCopyTests(unittest.TestCase):
    # Riutilizzo fixture di cattura e cifratura, non le prove della classe base.
    setUp = fixtures.ArubaTests.setUp
    tearDown = fixtures.ArubaTests.tearDown
    capture = fixtures.ArubaTests.capture
    def test_roundtrip_contains_ciphertext_only_and_no_credentials(self):
        result = self.capture()
        target = self.work / "offline.tar"
        report = maintenance.export_copy(self.archive, result["manifest"], self.archive_project(), target, 2)
        self.assertGreater(report["files"], 3)
        with tarfile.open(target) as tar:
            self.assertTrue(all(m.name == "index.json" or m.name.endswith(".cipher") for m in tar.getmembers()))
            self.assertNotIn("password", tar.extractfile("index.json").read().decode())
        checked = maintenance.verify_copy(target, self.archive.key, self.archive_project())
        self.assertTrue(checked["all_plaintext_hashes_match"])
        self.assertFalse(checked["physical_offline_custody"])

    @staticmethod
    def archive_project():
        from test_aruba import ARUBA_CONFIG
        return ARUBA_CONFIG["project_ref"]

    def export_fixture(self):
        result = self.capture()
        target = self.work / "offline.tar"
        maintenance.export_copy(self.archive, result["manifest"], self.archive_project(), target)
        return target

    def test_wrong_key_and_project_rejected(self):
        target = self.export_fixture()
        with self.assertRaises(backup.BackupError):
            maintenance.verify_copy(target, bytes([9])*32, self.archive_project())
        with self.assertRaises(backup.BackupError):
            maintenance.verify_copy(target, self.archive.key, "wrongproject")

    def test_altered_ciphertext_fails(self):
        target = self.export_fixture()
        bad = self.work / "tampered.tar"
        with tarfile.open(target) as src, tarfile.open(bad, "x") as dst:
            for member in src.getmembers():
                data = src.extractfile(member).read()
                if member.name == "00000001.cipher":
                    data = data[:-1] + bytes([data[-1] ^ 1])
                dst.addfile(member, io.BytesIO(data))
        with self.assertRaises(backup.BackupError):
            maintenance.verify_copy(bad, self.archive.key, self.archive_project())

    def test_path_traversal_extra_member_rejected_without_extraction(self):
        target = self.export_fixture()
        with tarfile.open(target, "a") as tar:
            member = tarfile.TarInfo("../outside"); member.size = 3
            tar.addfile(member, io.BytesIO(b"bad"))
        with self.assertRaises(backup.BackupError):
            maintenance.verify_copy(target, self.archive.key, self.archive_project())
        self.assertFalse((self.work.parent / "outside").exists())

    def test_public_destination_and_overwrite_rejected(self):
        result = self.capture()
        target = self.work / "offline.tar"; target.write_bytes(b"previous")
        with self.assertRaises(backup.BackupError):
            maintenance.export_copy(self.archive, result["manifest"], self.archive_project(), target)
        self.assertEqual(target.read_bytes(), b"previous")
        public = self.work / "public"; public.mkdir(); public.chmod(0o755)
        with self.assertRaises(backup.BackupError):
            maintenance.export_copy(self.archive, result["manifest"], self.archive_project(), public/"new.tar")

    def test_download_failure_leaves_no_completed_archive(self):
        result = self.capture(); original = self.s3.get_object
        def damaged(**args):
            response = original(**args)
            if not args["Key"].endswith("manifest.json.gz"):
                response["Body"] = io.BytesIO(b"broken")
            return response
        with patch.object(self.s3, "get_object", side_effect=damaged):
            with self.assertRaises(backup.BackupError):
                maintenance.export_copy(self.archive, result["manifest"], self.archive_project(), self.work/"offline.tar", 2)
        self.assertFalse((self.work/"offline.tar").exists())
        self.assertFalse((self.work/"offline.tar.partial").exists())
