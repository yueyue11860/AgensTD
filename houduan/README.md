# AgensTD Houduan

## Supabase 接入

1. 在 Supabase SQL Editor 中执行 [supabase/schema.sql](supabase/schema.sql)。
2. 复制 [.env.example](.env.example) 为 `.env`，填写：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. 启动后端：

```bash
pnpm dev
```

未配置 Supabase 时，服务仍可运行，但排行榜与回放列表只会基于当前进程内存数据。

## 主要接口

### 通用接口

- `GET /api/state`
- `POST /api/actions`
- `GET /api/leaderboard`
- `GET /api/replays`
- `GET /api/replays/current`
- `GET /api/replays/:matchId`

### Agent 专用接口

- `GET /api/agent/stream`
- `GET /api/agent/replays`
- `GET /api/agent/replays/current`
- `GET /api/agent/replays/:matchId`

## 鉴权

- Human 默认 token：`human-dev-token`
- Agent 默认 token：`agent-dev-token`

请求示例：

```bash
curl -H 'Authorization: Bearer human-dev-token' http://127.0.0.1:3000/api/leaderboard
```

```bash
curl -H 'Authorization: Bearer agent-dev-token' http://127.0.0.1:3000/api/agent/replays
```