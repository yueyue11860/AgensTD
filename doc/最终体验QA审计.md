# 最终体验 QA 审计

## 验收边界

- 固定产物：每轮在唯一临时 `outDir` 构建后计算 SHA-256，再用 Vite preview 读取不可变产物；不读共享 `FE/dist`。
- 真实旅程门 A：首页→房间→选关→真实 UI 召唤/键盘部署→同一权威 action parser/限流/幂等/checkpoint 路径的后续构筑→真实战斗终局→真实 settlement。不注入伤害、资源、胜负或奖励。
- 渲染/协议压力门 B：仅在 `PVE_E2E_ENABLED=true && NODE_ENV!=production` 时可用，通过保留 Socket 房间向真实 FE `TICK_UPDATE` / `COMBAT_EVENT_BATCH` 消费链投喂权威格式增量。它是 renderer/protocol fixture，不是真实对局，不进入 engine/account/reward/settlement。
- 逻辑时间只按 `authoritativeTickDelta × 100ms` 计算，禁止以 wall time 乘理论倍率充当证据。
- 本机只有 Chromium headless 软件渲染；无 WebKit binary，无实体触控设备。Playwright `hasTouch` 与 Canvas 点按只是桌面近似，不冒充实机结论。

## 可复跑入口

```bash
cd FE
pnpm test:e2e:experience
```

脚本：`FE/scripts/production-experience-qa.mjs`；机器可读报告：`output/playwright/production-experience-qa.json`。门禁任一 verdict 失败即非零退出。

## 门禁

| 项目 | 阈值 |
|---|---:|
| Chromium headless software FPS | `>= 20` |
| frame p95 | `<= 55ms` |
| Long task | `<= 25` |
| DOM 节点 | `<= 2500` |
| active / pooled VFX | `<= 32 / 66` |
| JS heap 增长 | `<= 64MiB` |
| B active enemies | `>= 80` |
| B combat event batches | `>= 300` |
| B 逻辑时长 | `>= 300,000ms` |
| 横向溢出 | 0 |

## 最近一次固定条件结果

产物 SHA-256：`8625613bbc09e107fafcf9fe7206295eac544a6367ba0adbc3f668ebe75030ac`，42 个文件。

### A：真实主链（通过）

- 真实 UI 首次部署成功；切速前通过同一服务端权威路径合法铺出 5 兵，全程接受 42 个后续构筑动作。
- 逻辑 tick 差 3,040，即 304,000ms；达到第 14 波后真实败北，settlement 可见。
- 累计见到 139 个敌人，收到 669 个真实战斗事件批。
- offline 恢复约 5.1s，reduced-motion 生效；业务 console error 为 0。
- 采样 FPS 24.6→21.8，frame p95 42.6→50.1ms；long task 0；峰值 DOM 404、active/pooled VFX 7/17，均通过硬门。
- 390×844、430×932、1280×720、1366×768、1920×1080 的首页与战局均无横向溢出。

### B：80 敌渲染/协议压力（通过）

- 80 active / 80 cumulative seen；344 个事件批；tick 差 3,170，即 317,000ms；wall 64.9s。
- 起始 22.9 FPS / p95 50.1ms；结束 22.4 FPS / p95 50.1ms，完全按原阈值通过，没有降低敌人数、事件门槛或帧阈值。
- DOM 245，long task 0，VFX active/pool 0/0，heap 17.3→66.6MiB（增长约 49.3MiB），390 无溢出，console error 0。
- E2E ticket 明确返回 `writesAccount=false`、`createsSettlement=false`；生产环境该入口为 404。本结果只证明真实 FE 渲染与协议消费能力，不证明这 80 个敌人由正常局内经济产生。

机器报告中的 A、B verdict 全部为 `true`，本轮命令退出码为 0。优化前的 code 1 报告仍保留在 `output/playwright/production-experience-qa.failed-renderer-performance-20260825.json`，便于对比追溯。

## 截图

- `output/playwright/qa-home-{width}x{height}.png`
- `output/playwright/qa-game-{width}x{height}.png`
- `output/playwright/qa-main-chain-deployed-1280x720.png`
- `output/playwright/qa-renderer-stress-1280x720.png`
- `output/playwright/qa-renderer-stress-390x844.png`
