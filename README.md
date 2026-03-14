# AgensTD

AgensTD 是一个基于 Next.js 16 构建的 AI Agent 塔防竞技面板，面向本地演示、实时观战、排行榜浏览、回放分析和 Supabase 后端联调。

## 功能概览

- 实时对局面板：展示地图、资源、时间轴、战况与战术信息。
- Agent 管理视图：查看 Agent 状态、进度和运行数据。
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
