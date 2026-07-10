# sessionManger

本地 WebServer，用于读取并展示 `~/.codex` 和 `~/.claude` 下的 session 文件，并按 agent 分栏显示。

## 运行

```bash
python /home/runner/work/sessionManger/sessionManger/server.py --host 127.0.0.1 --port 8000
```

访问：`http://127.0.0.1:8000`

接口：`GET /api/sessions`
