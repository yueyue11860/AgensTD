# AgensTD 生产发布与持久化故障 Runbook

> **发布红线：跨进程续局依赖 migration 007 的 checkpoint、lease fencing 与 durable action inbox。Memory 故障演练通过不等于 Supabase 已可用；007 未在 staging 完成首次/二次执行、夺租约、旧进程 fencing 和 hash 对比前，必须停止新对局并排空活跃 PVE 后发布。**

本文只给出可执行步骤。仓库内验证未连接真实生产，也未在本机实际应用（not applied locally）任何 SQL。只有在隔离 staging 对 003–008 顺序应用和二次执行成功，才可解除数据库发布阻断。

## 1. 本地/CI 单一门禁

在 `BE/` 执行：

```bash
pnpm install --frozen-lockfile
pnpm release:verify
git diff --check
```

`release:verify` 包含 typecheck、build、全部 smoke/balance、协议/重连检查、迁移静态检查和持久化故障演练。静态 SQL 通过不代表迁移已在 Postgres 应用。

## 2. 部署前人工动作（必须逐项签字）

1. 冻结 schema 与应用版本，记录镜像 digest、git SHA、当前规则集和负责人。
2. 创建并验证 Supabase/Postgres 时间点备份。
3. 在 secret manager 确认 Supabase URL、service role key 以及前端 anon key。不得把值写入工单、日志或 shell history。
4. 生产必须解析为 `PVP_STORE=supabase`、`PVE_REWARD_STORE=supabase`、`PVE_CHECKPOINT_STORE=supabase`；真人身份只由 Supabase Auth 验证。
5. 首次启用 007 前停止新 PVE 匹配，等待活跃战局结束并记录排空时刻。完成 staging 跨进程演练后的后续滚动发布才可依赖权威续局。
6. 在隔离 staging 使用生产同版本 Postgres 完成 003–008 首次与二次执行并保存输出。此步骤是部署阻断项。
7. 创建一个 Supabase Auth 测试账号，确认 `public.users` 与 `user_progress` 自动同步，且 JWT 可访问 `/api/auth/me`。
8. 在与生产同区域的 staging 压测 action ACK，分别保存 P50/P95/P99 与吞吐。服务端每个新 action 的同步持久化预算必须只有一次 `reserve_pve_match_action` RPC；checkpoint 写入不得串在 ACK 前。Memory smoke 的数字只衡量本地逻辑，不能代替这一步。

## 3. Migration 003–008 顺序

必须严格按以下顺序，使用具备 DDL 权限的受控连接。示例使用 `psql`；也可由 Supabase migration runner 逐个执行，但不可在 SQL Editor 中乱序粘贴。

```bash
cd BE
for migration in \
  supabase/migrations/202608250003_pve_reward_outbox.sql \
  supabase/migrations/202608250004_auth_sessions_readiness.sql \
  supabase/migrations/202608250005_encrypt_auth_provider_tokens.sql \
  supabase/migrations/202608250006_pve_settlement_detail.sql \
  supabase/migrations/202608250007_pve_match_checkpoint.sql \
  supabase/migrations/202608250008_supabase_auth_identity.sql
do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
```

依赖关系：005 依赖 004 的历史 `auth_sessions`；006 依赖 003 的 `pve_settlement_outbox`；007 创建 checkpoint、generation lease 和 durable action RPC；008 把 Supabase `auth.users` 同步为游戏资料。004/005 只为已部署环境保留历史兼容，当前服务不再读写其 OAuth 表。六个脚本均为显式事务和可重跑 DDL。

在 staging 完整重复上述循环一次，确认第二次仍成功。生产只按 migration history 应用一次。

应用后只读核验：

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('pve_reward_batches','pve_settlement_outbox','oauth_states','auth_sessions','service_persistence_probes','pve_match_leases','pve_match_checkpoints','pve_match_actions')
order by table_name;

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('pve_settlement_outbox','auth_sessions')
order by table_name, ordinal_position;
```

预期 migration 文件：

- `202608250003_pve_reward_outbox.sql`
- `202608250004_auth_sessions_readiness.sql`
- `202608250005_encrypt_auth_provider_tokens.sql`
- `202608250006_pve_settlement_detail.sql`
- `202608250007_pve_match_checkpoint.sql`
- `202608250008_supabase_auth_identity.sql`

## 4. Supabase Auth 身份核验

008 应用后，在 staging 分别验证注册、邮箱确认（如项目启用）、登录、刷新 token 与登出。创建和更新账号时，
`public.users.id` 必须等于 `auth.users.id::text`，且 `user_progress.player_type='HUMAN'`。旧
`oauth_states`/`auth_sessions` 表不再被服务访问，不要在本次发布中删除；待独立数据保留审批后再处理。

## 5. 启动、readiness 与故障演练

服务在监听端口前执行 settlement recovery、PVE checkpoint 恢复/夺租约和 Supabase 写入/删除探针。任一步失败即 fail-closed，拒绝监听。部署平台 readiness 使用：

```bash
curl --fail --silent --show-error https://<host>/health
```

必须看到 HTTP 200、`ok=true`、`persistence.status=ready`、`persistence.writable=true`、`stores.auth=supabase`、`pveCheckpoint.status=ready`。不要只检查进程存活。

故障演练必须先在 staging 做：

1. 撤销 staging service role 写权限或使用无效凭据启动候选实例，确认实例不监听/不进入流量池。
2. 恢复凭据，写入一条 `pending` 和一条可重试 `failed` settlement fixture，重启服务，确认 recovery 后为 `committed`；同一 `settlement_id` 在账户中只能结算一次。
3. 重放相同 wave milestone，确认 `batch_key` 返回同一事件且不重复增加碎片。
4. 在运行中 checkpoint 后先启动进程 B，确认旧 lease 未过期时 B 得到 `PVE_LEASE_HELD`、不监听且不进入流量池；不得允许 B 提前抢占。
5. 停止进程 A，等待数据库中的 `lease_expires_at` 过去，再启动/重试 B。B 必须取得 `generation+1`，并在 claim 后重新读取该 match 的最新 checkpoint；恢复前后 canonical `state_hash` 必须一致。
6. 保留一条“已 reserve、未应用”的 action 后重启，确认 B 只补执行一次；相同 requestId 返回 duplicate，不同 payload 返回 conflict。用超过 1000 条 action 的 fixture 验证分页 replay 无遗漏。
7. 恢复后 `recentEvents` 必须为空，客户端不能收到历史 VFX；奖励 ledger 与 settlement outbox 仍分别幂等/exactly-once。
8. 尝试让进程 A 再次 renew/save/reserve，必须返回 `PVE_LEASE_FENCED`；如果旧进程仍可写，立即停止发布。
9. 对新 action 采集 ACK P50/P95/P99、`reserve_pve_match_action` 数据库耗时和错误率；确认每个新 action 只有一次同步数据库往返，同进程 duplicate 可由内存命中，关键动作 checkpoint 在 ACK 后异步完成。

只读观察 SQL：

```sql
select status, count(*)
from public.pve_settlement_outbox
group by status
order by status;

select settlement_id, attempts, last_error, updated_at
from public.pve_settlement_outbox
where status in ('pending','failed')
order by updated_at
limit 100;

select l.match_id, l.room_id, l.holder_id, l.generation, l.lease_expires_at,
       c.checkpoint_tick, c.last_action_sequence, c.state_hash
from public.pve_match_leases l
left join public.pve_match_checkpoints c using (match_id)
order by l.updated_at desc;
```

存在持续 `failed`、非预期 fingerprint 冲突、recovery scan 失败、action reserve 延迟异常或 backlog 不下降时停止放量。部署编排必须为 30 秒 lease TTL 留出过期/重试窗口；候选实例因 `PVE_LEASE_HELD` 启动失败是安全行为，不能绕过 fencing 强行放流。

## 6. 回滚与恢复边界

所有 migration 采用 forward-fix；事故中禁止 drop table/column 或清空 outbox。

- 003：旧应用可忽略新表；保留 ledger/outbox。数据损坏时从已验证备份恢复，不删除未提交奖励。
- 004/005：仅为历史兼容保留旧 OAuth 表；当前应用不依赖它们，也不在本发布中删除。
- 006：`detail_json` 可空，旧应用可忽略；保留列和已有结算事实。
- 007：不可在活跃战局中回滚到不识别 checkpoint/action inbox 的应用。先停止新局并排空或完成所有结算；保留 lease/checkpoint/action 表供审计，使用 forward-fix。
- 008：触发器或资料同步异常时 forward-fix；不得删除已生成的玩家资料或进度。

完成回滚后重新执行 readiness、checkpoint hash/fencing、outbox backlog、账户 exactly-once 核验。只有 staging 已验证 007 的版本可以在活跃战局下执行进程替换；降级到旧版仍必须先排空。
