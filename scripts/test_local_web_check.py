import contextlib
import importlib.util
import io
import json
from pathlib import Path
import socket
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("local_web_check", Path(__file__).with_name("local-web-check.py"))
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


class LauncherChecks(unittest.TestCase):
    def test_occupied_port_is_rejected_without_closing_server(self):
        with socket.socket() as server:
            server.bind(("127.0.0.1", 0))
            server.listen()
            port = server.getsockname()[1]
            with self.assertRaisesRegex(RuntimeError, "no esta disponible"):
                checks.check_port(port)
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                connection, _ = server.accept()
                connection.close()

    def test_free_port_is_released_after_check(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        checks.check_port(port)
        checks.check_port(port)

    def test_build_reports_exact_folder_and_rejects_stale_or_incomplete_build(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in ("dist", "extension/public", "web-dist"):
                (root / relative).mkdir(parents=True)
            for relative in ("dist/manifest.json", "extension/public/manifest.json"):
                (root / relative).write_text(json.dumps({"version": "0.5.1"}), encoding="utf-8")
            for relative in ("dist/content.js", "dist/background.js", "web-dist/index.html"):
                (root / relative).write_text("fixture", encoding="utf-8")
            (root / ".env").write_text("GEMINI_API_KEY=PRIVATE_SENTINEL", encoding="utf-8")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                checks.describe_build(root)
            self.assertIn(str(root / "dist"), output.getvalue())
            self.assertIn("0.5.1", output.getvalue())
            self.assertNotIn("PRIVATE_SENTINEL", output.getvalue())
            (root / "dist/content.js").unlink()
            with self.assertRaisesRegex(RuntimeError, "Falta la compilacion"):
                checks.describe_build(root)
            (root / "dist/manifest.json").write_text('{"version":"0.5.0"}', encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "otra version"):
                checks.describe_build(root)


if __name__ == "__main__":
    unittest.main()
