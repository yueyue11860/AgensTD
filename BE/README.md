# AgensTD Houduan

## Supabase 接入

1. 在 Supabase SQL Editor 中执行 [supabase/schema.sql](supabase/schema.sql)。
2. 复制 [.env.example](.env.example) 为 `.env`，填写：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. 如果前端也要接收排行榜实时更新，还需要准备浏览器端可公开使用的 `SUPABASE_ANON_KEY`，供前端 `.env` 使用。
4. 启动后端：

```bash
pnpm dev
```

未配置 Supabase 时，服务仍可运行，但排行榜与回放列表只会基于当前进程内存数据。

补充说明：当前 SQL 脚本会把 `leaderboard_entries` 加入 `supabase_realtime` publication，并给 `anon/authenticated` 只读权限，供前端订阅排行榜变更；不会把 `match_replays.replay_json` 暴露给浏览器端实时通道。

## 局域网联机测试

1. 在项目根目录执行 `./dev-stack.sh restart`，确保前端跑在 `5173`、后端跑在 `3000`。
2. 找到宿主机局域网 IP，例如 `192.168.1.23`。
3. 让每台测试设备访问同一个前端地址，但带不同玩家参数：

```text
http://192.168.1.23:5173/?playerId=alice&playerName=Alice
http://192.168.1.23:5173/?playerId=bob&playerName=Bob
```

说明：

- Vite 开发服务已监听 `0.0.0.0`，同网段设备可直接访问。
- 前端如果发现配置里写的是 `127.0.0.1`/`localhost`，会在局域网访问时自动改写为当前浏览器打开的宿主机地址，避免客户端去连“自己本机”的 `3000` 端口。
- 当前静态 dev token 仍可用于局域网测试，但 Socket 身份会优先采用 URL 里的 `playerId`/`playerName`，这样不同设备不会再被识别成同一个玩家。
- 如果你要测试 OAuth 登录，而不是 dev token，需要把 [.env.example](.env.example) 里的 `OAUTH_REDIRECT_URI` 改成宿主机局域网 IP 对应的回调地址。

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