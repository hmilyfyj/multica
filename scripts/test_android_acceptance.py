import importlib.util
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("acceptance", Path(__file__).with_name("android-acceptance.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SupervisionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name) / "attempt"

    def run_child(self, code, **kwargs):
        return module.supervise([sys.executable, "-c", code], self.out, os.environ,
                                kwargs.pop("health", lambda: None), interval=.01, **kwargs)

    def test_exited_child_does_not_wait_for_budget(self):
        result = self.run_child("import os,pathlib;pathlib.Path(os.environ['OUT'],'results.tsv').write_text('D1\\tpass\\tok\\n')")
        self.assertEqual(result["status"], "passed")
        self.assertLess(result["elapsed"], 2)

    def test_zero_exit_without_evidence_is_not_success(self):
        self.assertEqual(self.run_child("pass")["status"], "failed")

    def test_no_progress_kills_owned_child_and_keeps_diagnostics(self):
        result = self.run_child("import time;time.sleep(30)", idle=.1)
        self.assertEqual(result["status"], "blocked")
        self.assertIn("no new result", result["reason"])
        with self.assertRaises(ProcessLookupError): os.kill(result["pid"], 0)
        self.assertTrue((self.out / "supervisor.json").exists())

    def test_unavailable_device_does_not_launch_runner(self):
        def health(): raise RuntimeError("device lost")
        result = self.run_child("raise Exception('must not execute')", health=health)
        self.assertEqual(result["status"], "blocked")
        self.assertIsNone(result["pid"])

    def test_failed_assertion_is_failure_even_with_zero_shell_exit(self):
        result = self.run_child("import os,pathlib;pathlib.Path(os.environ['OUT'],'results.tsv').write_text('D1\\tfail\\twrong result\\n')")
        self.assertEqual(result["status"], "failed")

    def test_resume_rejects_missing_or_changed_evidence(self):
        self.out.mkdir()
        evidence = self.out / "results.tsv"
        evidence.write_text("D1\tpass\tok\n")
        record = dict(status="passed", evidence=str(self.out), evidence_sha256=hashlib.sha256(evidence.read_bytes()).hexdigest())
        self.assertTrue(module.evidence_passed(record))
        evidence.write_text("D1\tfail\tchanged\n")
        self.assertFalse(module.evidence_passed(record))
        evidence.unlink()
        self.assertFalse(module.evidence_passed(record))


if __name__ == "__main__": unittest.main()
