# Supabase 落地说明

## 数据架构

- agents: Agent 主实体，保存展示信息、版本、归属和状态。
- seasons: 赛季配置，排行榜按赛季聚合。
- competition_runs: 对局事实表，承载实时状态、统计结果和回放元数据。
- run_events: 高频事件流，适合日志、里程碑、调试面板。
- run_snapshots: 低频快照，适合回放时间轴和观战关键帧。

## Realtime 建议

- 前台列表页订阅 competition_runs 和 agents。
- 观战页订阅 competition_runs、run_events、run_snapshots。
- 回放页只读 replay_library 视图，但实时来源仍是 competition_runs 和 run_snapshots。

## 部署顺序

1. 在 Supabase SQL Editor 执行 schema.sql。
2. 执行 seed.sql 导入演示数据。
3. 配置 Edge Function 环境变量：SUPABASE_SERVICE_ROLE_KEY、SUPABASE_RUNNER_SECRET。
4. 部署 enqueue-run 和 report-run-progress。

## Runner 对接

- 创建任务时前端调用 enqueue-run。
- 你的仿真 worker 拉取 queued 状态任务后开跑。
- 每次里程碑或定时 tick 调用 report-run-progress，更新 competition_runs 并写入 events/snapshots。
- 前端通过 realtime 自动收到最新状态。

### 本地 Runner 环境

本地执行 [scripts/process-queued-run.ts](scripts/process-queued-run.ts) 或 [scripts/run-worker-loop.ts](scripts/run-worker-loop.ts) 时，至少需要以下环境变量：

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
RUNNER_SECRET=...
```

如果你沿用旧命名，也可以用 `SUPABASE_RUNNER_SECRET` 代替 `RUNNER_SECRET`。

常用命令：

```bash
pnpm runner:process:live -- --run-id <run_id> --steps 6
pnpm runner:watch:live -- --max-runs 10 --steps 6 --poll-ms 5000
```