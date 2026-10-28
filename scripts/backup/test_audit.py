import datetime as dt
import importlib.util
import json
from unittest import TestCase, skipUnless
from unittest.mock import patch

import audit
import backup
import test_aruba as fixtures


@skipUnless(importlib.util.find_spec("cryptography"), "Installare requirements-aruba.lock")
class AuditTests(TestCase):
    setUp = fixtures.ArubaTests.setUp
    tearDown = fixtures.ArubaTests.tearDown
    capture = fixtures.ArubaTests.capture

    def test_quarter_boundaries(self):
        self.assertEqual(audit.quarter(dt.datetime(2026,12,31)),"2026-4")
        self.assertEqual(audit.quarter(dt.datetime(2027,1,1)),"2027-1")

    def test_expiry_is_pending_until_provider_removes_specific_version(self):
        state, path = {}, self.work/"state.json"
        status = audit.expiry_probe(self.archive,fixtures.ARUBA_CONFIG["project_ref"],state,path)
        self.assertEqual(status,"synthetic_probe_created")
        self.assertEqual(audit.expiry_probe(self.archive,fixtures.ARUBA_CONFIG["project_ref"],state,path),"awaiting_actual_version_expiration")
        self.archive.now += dt.timedelta(days=4)
        key=state["expiry_probe"]["archive"]["key"]
        del self.s3.objects[key]
        class Gone(Exception):
            response={"Error":{"Code":"NoSuchVersion"}}
        with patch.object(self.s3,"head_object",side_effect=Gone()):
            self.assertEqual(audit.expiry_probe(self.archive,fixtures.ARUBA_CONFIG["project_ref"],state,path),"version_expiration_observed")

    def test_premature_missing_and_late_expiration_fail(self):
        state, path = {}, self.work/"state.json"
        audit.expiry_probe(self.archive,fixtures.ARUBA_CONFIG["project_ref"],state,path)
        class Gone(Exception):
            response={"Error":{"Code":"404"}}
        with patch.object(self.s3,"head_object",side_effect=Gone()):
            with self.assertRaises(backup.BackupError):
                audit.expiry_probe(self.archive,fixtures.ARUBA_CONFIG["project_ref"],state,path)
        self.archive.now += dt.timedelta(days=8)
        with self.assertRaises(backup.BackupError):
            audit.expiry_probe(self.archive,fixtures.ARUBA_CONFIG["project_ref"],state,path)

    def test_provider_auth_error_not_misclassified_as_expiry(self):
        state, path = {}, self.work/"state.json"
        audit.expiry_probe(self.archive,fixtures.ARUBA_CONFIG["project_ref"],state,path)
        class Forbidden(Exception):
            response={"Error":{"Code":"AccessDenied"}}
        with patch.object(self.s3,"head_object",side_effect=Forbidden()):
            with self.assertRaises(Forbidden):
                audit.expiry_probe(self.archive,fixtures.ARUBA_CONFIG["project_ref"],state,path)

    def test_periodic_restore_once_per_quarter_and_retry_after_failure(self):
        manifest={"objects":[]}
        with patch.object(audit.maintenance,"connect",return_value=self.archive), \
             patch.object(audit,"latest_manifest",return_value=manifest), \
             patch.object(audit,"database_drill",side_effect=backup.BackupError("fixture")):
            with self.assertRaises(backup.BackupError):
                audit.run(fixtures.ARUBA_CONFIG,fixtures.SECRET,self.work/"state")
        state=json.loads((self.work/"state/state.json").read_text())
        self.assertNotIn("last_drill_quarter",state)
        with patch.object(audit.maintenance,"connect",return_value=self.archive), \
             patch.object(audit,"latest_manifest",return_value=manifest), \
             patch.object(audit,"database_drill",return_value={"all_copy_values_match":True}) as drill:
            self.assertTrue(audit.run(fixtures.ARUBA_CONFIG,fixtures.SECRET,self.work/"state")["database_drill_performed"])
            self.assertFalse(audit.run(fixtures.ARUBA_CONFIG,fixtures.SECRET,self.work/"state")["database_drill_performed"])
            self.assertEqual(drill.call_count,1)
