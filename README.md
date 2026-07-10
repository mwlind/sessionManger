# sessionManger

Node.js + Express + Vue3(Vite) 本地 Session 管理器：
- 后端读取 `~/.codex`、`~/.claude` 下的会话文件
- 按 agent 分组后通过 `GET /api/sessions` 返回 JSON
- 前端按 agent 分栏展示会话卡片

## 安装依赖

```bash
npm install
npm --prefix frontend install
```

## 本地开发

终端 1（后端 API，默认 `http://127.0.0.1:3000`）：

```bash
npm run dev:api
```

终端 2（前端 Vite，默认 `http://127.0.0.1:5173`，已代理 `/api` 到后端）：

```bash
npm run dev:web
```

## 构建并由 Express 托管前端

```bash
npm run build
npm start
```

## 测试

```bash
npm test
```
