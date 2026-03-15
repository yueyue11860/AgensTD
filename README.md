# AgensTD

AgensTD 是一个基于 Next.js 16 构建的塔防竞技面板，面向本地演示、排行榜浏览、回放分析和 Supabase 后端联调。

## 功能概览

- 实时对局面板：展示地图、资源、时间轴、战况与战术信息。
- 排行榜与回放：支持赛季排名、历史战绩与对局回看。
- Supabase 集成：预留 schema、seed 和 Edge Functions，用于任务排队与进度回传。

## 技术栈

- Next.js 16 + React 19
- TypeScript
- Tailwind CSS 4
- Radix UI
- Supabase

## 本地开发

```bash
pnpm install
pnpm dev
```

默认开发地址为 http://localhost:3000。

## 常用命令

```bash
pnpm dev
pnpm lint
pnpm build
pnpm runner:process
pnpm runner:process:live
pnpm runner:watch
pnpm runner:watch:live
pnpm regression:deterministic
```

## 提交规范

仓库已配置基于 Conventional Commits 的基础校验。建议使用如下前缀：

- feat: 新功能
- fix: 修复问题
- docs: 文档更新
- refactor: 重构
- test: 测试相关
- chore: 杂项维护

示例：

```text
feat: add live replay panel
fix: handle empty rankings state
```

## Supabase

数据库结构和部署顺序见 [supabase/README.md](supabase/README.md)。

本地 worker dry-run 可用下面的命令验证共享上报链路：

```bash
pnpm runner:process
```

连接真实 Supabase 环境后，可以直接处理单个排队 run：

```bash
pnpm runner:process:live
```

也可以启动轻量轮询 worker：

```bash
pnpm runner:watch -- --max-runs 3 --steps 6
```

真实环境下的常驻轮询入口：

```bash
pnpm runner:watch:live -- --max-runs 10 --steps 6 --poll-ms 5000
```

默认脚本会以 dry-run 模式执行一次轮询；接入真实环境时可去掉 `--dry-run`：

```bash
node --experimental-strip-types scripts/run-worker-loop.ts --max-runs 3 --steps 6
```

真实 runner 至少需要这些环境变量：

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
RUNNER_SECRET=...
```
