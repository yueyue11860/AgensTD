# AgensTD Houduan

生产发布、migration 003–008、outbox 重启恢复和回滚步骤见
[PRODUCTION_RELEASE_RUNBOOK.md](PRODUCTION_RELEASE_RUNBOOK.md)。发布前统一执行 `pnpm release:verify`。

## 运行拓扑

Node 进程默认只承担权威游戏服务，不直接托管前端页面：

- `http://127.0.0.1:5173`：Vite 前端开发服务器；
- `http://127.0.0.1:3000/api/*`：REST API；
- `http://127.0.0.1:3000/socket.io/*`：Socket.IO 实时网关；
- `http://127.0.0.1:3000/health`：无需登录的健康检查。

开发时只应把 `5173` 作为玩家入口。生产环境由 Nginx/静态站点提供前端，并将 `/api` 与
`/socket.io` 反向代理到 Node。只有兼容旧式单进程部署时才设置 `SERVE_FRONTEND=true`；该模式要求
先生成 `FE/dist`，否则后端会拒绝启动，避免意外发布过期页面。

## Supabase 接入

1. 在 Supabase SQL Editor 中执行 [supabase/schema.sql](supabase/schema.sql)。
2. 复制 [.env.example](.env.example) 为 `.env`，填写：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   `.env` 已被 Git 忽略，不得把 service role key 提交到仓库；若密钥曾进入 Git 历史，必须在 Supabase 侧轮换。
3. 前端 `.env` 配置 `VITE_SUPABASE_URL` 与浏览器可公开使用的 `VITE_SUPABASE_ANON_KEY`。登录、注册、会话刷新与 Realtime 共用这一 Supabase 客户端。
4. 启动后端：

```bash
pnpm dev
```

开发环境未配置 Supabase 时可使用内存账户与奖励账本。`NODE_ENV=production` 会强制要求
`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 和 `PVE_REWARD_STORE=supabase`（默认自动选择）；
缺少持久化或恢复扫描失败时服务拒绝监听端口，禁止静默以内存结算。

## Supabase Auth

真人账号只使用 Supabase Auth 邮箱/密码登录。浏览器提交 Supabase access token，后端通过
`auth.getUser(token)` 验证后才生成游戏身份；客户端缓存资料不能绕过服务端鉴权。执行
`supabase/migrations/202608250008_supabase_auth_identity.sql` 后，`auth.users` 的新增与资料更新会同步到
`public.users`，同时创建默认 `user_progress`。迁移 004/005 创建的旧 OAuth 表仅保留为历史部署记录，
当前应用不会读写这些表。

增量部署必须执行 `supabase/migrations/202608250003_pve_reward_outbox.sql`。它创建里程碑奖励账本与
结算 outbox；两张表仅允许 service role 访问。结算状态可由玩家本人通过
`GET /api/settlements/:matchId` 查询，返回 `pending`、`committed` 或 `failed`。

跨进程 PVE 续局还必须执行 `supabase/migrations/202608250007_pve_match_checkpoint.sql`，并设置
`PVE_CHECKPOINT_STORE=supabase`。运行态按固定 tick 与关键命令保存；新进程以递增 generation 夺取
lease，旧 generation 的 checkpoint/action 写入会被拒绝。恢复会保留 PRNG、定时器、构筑和命令
幂等状态，但会清空历史 `recentEvents`，避免重放 VFX。生产实际启用前必须完成 runbook 中的 staging
双进程 fencing/hash 演练；仓库本地 smoke 不代表 SQL 已真实应用。

## 后端质量门禁

```bash
pnpm test:smoke   # 全部现有 smoke（含结算故障恢复与 HTTP 三态）
pnpm test:balance # PVE/Boss 数值趋势
pnpm test:ci      # typecheck + production build + 上述全部门禁
pnpm release:verify # CI + migration 静态检查 + 持久化故障演练
```

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
- 如需测试真实登录，请给前端配置同一 Supabase 项目的 URL 与 anon key；无需回调地址。

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

- Human 生产鉴权：Supabase Auth access token
- Human 本地/E2E 默认 token：`human-dev-token`
- Agent 默认 token：`agent-dev-token`

`pnpm dev` 启动的前端会提供一个仅开发模式生效的无数据库测试账号：

- 邮箱：`dev@agenstd.local`
- 密码：`dev123456`

该账号在浏览器端换取上述 Human 本地 token，后端使用内存 store；进程重启后数据会重置。生产模式不接受该账号或静态 Human token。
仓库根目录的 `./dev-stack.sh start` 默认以该纯内存模式启动前后端。

请求示例：

```bash
curl -H 'Authorization: Bearer human-dev-token' http://127.0.0.1:3000/api/leaderboard
```

```bash
curl -H 'Authorization: Bearer agent-dev-token' http://127.0.0.1:3000/api/agent/replays
```
