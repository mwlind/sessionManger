import tempfile
import unittest
from pathlib import Path

from server import discover_sessions, group_by_agent, render_html


class SessionServerTests(unittest.TestCase):
    def test_discover_sessions_extracts_agent_from_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / ".codex"
            root.mkdir(parents=True)
            file_path = root / "session.json"
            file_path.write_text(
                '{"session_id":"s-1","title":"test","agent_name":"codex-agent"}',
                encoding="utf-8",
            )

            sessions = discover_sessions([root])

            self.assertEqual(len(sessions), 1)
            self.assertEqual(sessions[0].session_id, "s-1")
            self.assertEqual(sessions[0].title, "test")
            self.assertEqual(sessions[0].agent, "codex-agent")
            self.assertEqual(sessions[0].source, "codex")

    def test_discover_sessions_uses_path_fallback_agent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / ".claude"
            (root / "nested").mkdir(parents=True)
            file_path = root / "nested" / "plain.log"
            file_path.write_text("not-json", encoding="utf-8")

            sessions = discover_sessions([root])

            self.assertEqual(len(sessions), 1)
            self.assertEqual(sessions[0].agent, "claude")
            self.assertEqual(sessions[0].session_id, "plain")

    def test_group_by_agent_and_render_html(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            codex = Path(tmp) / ".codex"
            claude = Path(tmp) / ".claude"
            codex.mkdir(parents=True)
            claude.mkdir(parents=True)

            (codex / "a.json").write_text(
                '{"session_id":"a1","agent":"codex","title":"A"}', encoding="utf-8"
            )
            (claude / "b.json").write_text(
                '{"session_id":"b1","agent":"claude","title":"B"}', encoding="utf-8"
            )

            grouped = group_by_agent(discover_sessions([codex, claude]))
            html = render_html(grouped)

            self.assertEqual(sorted(grouped.keys()), ["claude", "codex"])
            self.assertIn("<h2>claude</h2>", html)
            self.assertIn("<h2>codex</h2>", html)


if __name__ == "__main__":
    unittest.main()
