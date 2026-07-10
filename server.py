from __future__ import annotations

import argparse
import html
import json
from dataclasses import dataclass
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

DEFAULT_SESSION_DIRS = [Path("~/.codex").expanduser(), Path("~/.claude").expanduser()]
MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024


@dataclass
class SessionRecord:
    agent: str
    source: str
    title: str
    session_id: str
    path: str
    updated_at: str


def _normalize_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _extract_agent(payload: dict[str, Any], path: Path, source_name: str) -> str:
    direct_keys = ["agent", "agent_name", "assistant", "model"]
    for key in direct_keys:
        candidate = _normalize_str(payload.get(key))
        if candidate:
            return candidate

    nested_keys = ["metadata", "session", "config"]
    for container_key in nested_keys:
        container = payload.get(container_key)
        if not isinstance(container, dict):
            continue
        for key in direct_keys:
            candidate = _normalize_str(container.get(key))
            if candidate:
                return candidate

    path_lower = str(path).lower()
    if "codex" in path_lower:
        return "codex"
    if "claude" in path_lower:
        return "claude"
    return source_name or "unknown"


def _extract_first_json(path: Path) -> dict[str, Any]:
    content = path.read_text(encoding="utf-8", errors="ignore").strip()
    if not content:
        return {}

    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue

    return {}


def _build_session_record(path: Path, source_dir: Path) -> SessionRecord:
    payload = _extract_first_json(path)
    stat = path.stat()
    source_name = source_dir.name.lstrip(".")

    session_id = (
        _normalize_str(payload.get("session_id"))
        or _normalize_str(payload.get("id"))
        or path.stem
    )
    title = (
        _normalize_str(payload.get("title"))
        or _normalize_str(payload.get("name"))
        or path.name
    )
    updated_at = datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds")
    agent = _extract_agent(payload, path, source_name)

    return SessionRecord(
        agent=agent,
        source=source_name or "unknown",
        title=title,
        session_id=session_id,
        path=str(path),
        updated_at=updated_at,
    )


def discover_sessions(session_dirs: list[Path] | None = None) -> list[SessionRecord]:
    roots = session_dirs or DEFAULT_SESSION_DIRS
    sessions: list[SessionRecord] = []

    for root in roots:
        if not root.exists() or not root.is_dir():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            try:
                if path.stat().st_size > MAX_FILE_SIZE_BYTES:
                    continue
                sessions.append(_build_session_record(path, root))
            except OSError:
                continue

    sessions.sort(key=lambda item: item.updated_at, reverse=True)
    return sessions


def group_by_agent(sessions: list[SessionRecord]) -> dict[str, list[SessionRecord]]:
    grouped: dict[str, list[SessionRecord]] = {}
    for record in sessions:
        grouped.setdefault(record.agent, []).append(record)
    return dict(sorted(grouped.items(), key=lambda item: item[0].lower()))


def render_html(grouped: dict[str, list[SessionRecord]]) -> str:
    columns: list[str] = []
    for agent, records in grouped.items():
        card_items: list[str] = []
        for item in records:
            card_items.append(
                "".join(
                    [
                        '<article class="session-card">',
                        f"<h3>{html.escape(item.title)}</h3>",
                        f"<div><strong>ID:</strong> {html.escape(item.session_id)}</div>",
                        f"<div><strong>来源:</strong> {html.escape(item.source)}</div>",
                        f"<div><strong>更新时间:</strong> {html.escape(item.updated_at)}</div>",
                        f"<div><strong>路径:</strong> <code>{html.escape(item.path)}</code></div>",
                        "</article>",
                    ]
                )
            )

        columns.append(
            "".join(
                [
                    '<section class="agent-column">',
                    f"<h2>{html.escape(agent)}</h2>",
                    "".join(card_items) or "<p>暂无会话</p>",
                    "</section>",
                ]
            )
        )

    if not columns:
        columns.append('<p class="empty">未发现会话文件，请检查 ~/.codex 和 ~/.claude。</p>')

    return "".join(
        [
            "<!doctype html>",
            '<html lang="zh-CN">',
            "<head>",
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            "<title>Session Manager</title>",
            "<style>",
            "body{font-family:system-ui,sans-serif;background:#f5f7fb;margin:0;padding:20px;color:#1f2937}",
            "h1{margin-top:0}",
            ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}",
            ".agent-column{background:#fff;border:1px solid #dbe2f0;border-radius:8px;padding:12px}",
            ".session-card{background:#f9fbff;border:1px solid #e2e8f0;border-radius:6px;padding:10px;margin-bottom:10px;word-break:break-word}",
            ".session-card h3{margin:0 0 8px 0;font-size:16px}",
            ".empty{background:#fff;padding:16px;border-radius:8px;border:1px solid #dbe2f0}",
            "</style>",
            "</head>",
            "<body>",
            "<h1>本地 Session 管理</h1>",
            '<div class="grid">',
            "".join(columns),
            "</div>",
            "</body>",
            "</html>",
        ]
    )


class SessionRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        sessions = discover_sessions()
        grouped = group_by_agent(sessions)

        if parsed.path == "/api/sessions":
            payload = {
                "agents": {
                    agent: [record.__dict__ for record in records]
                    for agent, records in grouped.items()
                }
            }
            content = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        if parsed.path == "/":
            content = render_html(grouped).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        self.send_response(404)
        self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        return


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local session manager web server")
    parser.add_argument("--host", default="127.0.0.1", help="server host")
    parser.add_argument("--port", type=int, default=8000, help="server port")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    server = ThreadingHTTPServer((args.host, args.port), SessionRequestHandler)
    print(f"Session Manager running on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
