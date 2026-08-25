# AgensTD 顶层升级规划：技术审计、QA 与表现落地

> 审计日期：2026-08-25  
> 审计范围：`FE`、`BE`、`shared/contracts`、现有素材、构建与 smoke；只读检查与验证，未修改业务代码。  
> 结论口径：这是“上线就绪度”审计，不等同于“代码是否能编译”。

## 0. 执行结论

当前项目的真实状态是：**PVE 玩法运行时与局外系统已具有可验证的工程骨架，PVP 的匹配/段位/结算域也已成形；但客户端战斗表现、PVP 实际战场、玩家可见的奖励结算、自动化测试与生产安全门禁仍未达到可发布标准。**

建议成熟度评分如下（5 分为可稳定运营）：

| 模块 | 成熟度 | 已具备 | 主要缺口 |
|---|---:|---|---|
| PVE 权威运行时 | 3.5/5 | 100ms Tick、确定性 PRNG、20 波、Boss、神将、羁绊、召唤、区域、状态、道具、武器接入 | 缺真实端到端、弱网、长局与性能门禁；数值只证明“趋势未倒挂”，没有真实玩家策略覆盖 |
| PVE 网络同步 | 3/5 | Socket.io、200ms 广播、patch/checkpoint/full、客户端旧包丢弃和缺基线重同步 | `pve` 每 200ms 仍整块发送；战斗事件无独立游标/ACK；断线宽限仅 5 秒 |
| PVE 战场表现 | 1.5/5 | Phaser 场景、地形、单位容器、敌人补间、血条、状态字、点击/拖放桥接 | 没有贴图加载、攻击/弹道/受击/死亡/VFX/SFX、浮字、镜头、动画降级策略 |
| PVE 对局结算 | 2.5/5 | 服务端幂等奖励流水、里程碑、胜负结算、账户 CAS | 客户端只显示胜负一句话，不显示奖励明细、统计、结算中/失败/重试状态 |
| PVP 平台域 | 2.5/5 | 真人鉴权边界、匹配、房间、权威 runtime、段位和结算 smoke | 当前默认内存存储；服务重启丢活动对局；实时状态用 500ms HTTP 轮询 |
| PVP 实际玩法/UI | 1/5 | HUD、投降、遣妖按钮、结果页 | 战场明确为 skeleton；无布阵/招募/攻击客户端，无 Phaser 对战渲染，无法形成完整可玩闭环 |
| Web UI / 响应式 | 2.5/5 | 多断点布局、PVE 29×29 FIT、PVP 640/900px 断点 | 移动端信息密度极高；Canvas 无键盘等价操作；焦点轮廓被全局清除；弹窗无焦点管理 |
| 素材管线 | 1/5 | 20 张高分辨率 PNG，约 52MB | 文件名不可维护、单张 1.2–4.8MB、无 atlas/WebP/AVIF、无 manifest、无音频，代码未引用 |
| 自动化 QA | 1.5/5 | 大量可手动执行 smoke、TypeScript strict、构建可过 | 无 `test` 脚本、无测试框架/覆盖率、无浏览器 E2E 配置、无 CI、无视觉回归/可访问性/兼容矩阵 |

### 本次实测证据

- `FE/pnpm build` 通过；产物：主 JS 785.19KB（gzip 236.86KB）、Phaser chunk 1,399.89KB（gzip 374.15KB）、CSS 158.74KB（gzip 31.54KB）。Vite 已明确报告 chunk 超过 500KB。入口虽通过懒加载隔离 Phaser（`FE/pages/gaming-page.tsx:17-20`），但进入战局的下载与解析成本仍高。
- `BE/pnpm check && pnpm build` 通过。
- 下列 smoke 均通过：PVE full、PVE balance、Boss runtime、PVP runtime、PVP HTTP、PVE reward、item、weapon、hero full catalog、synergy、matchmaking、rank、account。
- PVE balance Monte Carlo 的实测输出：简单关 1 纯天兵清关率 75.97%；但简单关 10、普通关 10、困难关 1 的纯天兵清关率均为 0。该测试只要求难度趋势不倒挂（`BE/src/pve-v2/balance-smoke.ts:131-146`），**不能据此宣称全局数值已经平衡**。
- 仓库没有 CI 配置；`FE/package.json:6-9` 只有 dev/build/preview，`BE/package.json:6-10` 只有 dev/start/build/check。smoke 必须由人逐个运行。

## 1. 现有实现与缺口地图

### 1.1 前后端与协议

已有优势：

- 服务端是权威状态源。`GameEngine` 将动作排队后在 Tick 中结算（`BE/src/core/game-engine.ts:406-449,566-640`），动作带 request receipt，具备重复请求识别基础（`BE/src/core/game-engine.ts:391-403`）。
- PVE runtime 明确按确定顺序推进生成、Boss、延迟动作、移动、DOT、区域、召唤、天兵与神将攻击（`BE/src/pve-v2/runtime.ts:599-629`），这对回放、数值模拟和反作弊非常有利。
- 协议有 full / patch / checkpoint 三态（`shared/contracts/game.ts:527-563`）；广播默认 200ms、权威校准默认 5s（`BE/src/config/server-config.ts:86-100`），完成帧会立即广播（`BE/src/core/projected-tick-stream.ts:105-119`）。
- 客户端拒绝旧 Tick，缺失全量基线时会 `REQUEST_FULL_STATE`（`FE/pages/gaming-page.tsx:763-793,977-983`），服务器也有重同步入口（`BE/src/network/socket-gateway.ts:286-300`）。

主要缺口：

- PVE patch 仍每次携带完整 `pve`（`BE/src/core/state-projection.ts:448-464`），而 `pve` 内含全部棋子、敌人、状态、区域和最多 300 条事件（`BE/src/pve-v2/runtime.ts:632-705,3885-3895`）。名义是增量同步，核心 PVE 数据实际仍是高频全量复制、序列化和传输。
- 客户端只把最近事件显示为文本日志（`FE/pages/gaming-page.tsx:1813-1819`）；传给 Phaser 的 `BattlefieldSnapshot` 不含事件（`FE/game/phaser/battlefield-model.ts:72-79`）。
- Socket PVE 允许非 OAuth 静态 principal 用 JOIN payload 覆盖 playerId/name（`BE/src/network/socket-gateway.ts:895-912`）。这是局域网调试便利，但生产若静态 token 泄露，会成为身份冒用路径。
- OAuth `state` 被生成并返回，但服务端没有持久化或在 exchange 时验证（`BE/src/network/oauth-routes.ts:130-139,145-180`）；会话也仅在进程内存中（`BE/src/network/oauth-routes.ts:9-18`），服务重启会强制全员掉线。

### 1.2 Phaser Battlefield

已有能力：

- React 只在进入战场时加载 Phaser（`FE/pages/gaming-page.tsx:17-20`）。
- 场景以固定 29×29、32px 逻辑单元渲染，并通过 `Phaser.Scale.FIT` 适配容器（`FE/components/phaser-battlefield.tsx:31-41`）。
- 已有稳定的实体视图 Map，支持复用/移除；敌人移动使用 220ms tween（`FE/game/phaser/battlefield-scene.ts:370-417`）。
- 地形主题支持关卡 palette（`FE/game/phaser/battlefield-scene.ts:165-199`）；已有选择态、落点预览、召唤、区域、状态和 Boss 血条基础。

关键事实：

- 场景没有 `preload()`，没有 `load.image/load.atlas/load.audio`；所有单位均由 `Graphics + Text` 绘制（`FE/game/phaser/battlefield-scene.ts:140-153,324-368,420-483`）。
- 唯一现成动态表现是敌人/召唤物位移 tween；棋子本身直接跳格（`FE/game/phaser/battlefield-scene.ts:300-321`）。
- 删除实体时立即 destroy，没有死亡动画或最后位置缓存（`FE/game/phaser/battlefield-scene.ts:378-384`）。
- 输入层只暴露 cell click/hover/leave（`FE/game/phaser/battlefield-model.ts:81-85`），没有键盘光标、手柄或语义化战场镜像。
- React effect 在 `sceneTheme` 或 `terrainMatrix` 引用改变时会销毁并重建整个 Phaser.Game（`FE/components/phaser-battlefield.tsx:23-47`）；必须确保二者引用稳定，否则会产生 Canvas 闪断和资源重复解码。

### 1.3 PVE 玩法、奖励与结算

- 战斗事件种类其实已相当完整：普攻起手、技能、伤害、死亡、Boss 预警、状态、召唤、区域、羁绊、波次与结算都存在（`BE/src/pve-v2/types.ts:219-276`）。伤害事件已有攻击者、目标、伤害、暴击、前后 HP 等表现所需核心字段（`BE/src/pve-v2/runtime.ts:1916-1929,2973-2983`）。因此**不应重写战斗逻辑，应该增加表现协议和客户端消费者**。
- 对局里程碑奖励和终局奖励由队列串行，使用 match/player/milestone key 去重（`BE/src/network/socket-gateway.ts:606-646`）；终局落账户时也检查 settlement id（`BE/src/network/socket-gateway.ts:698-740`）。
- 断线 5 秒后会按离场玩家单独结算（`BE/src/network/socket-gateway.ts:783-821`）。5 秒对移动网络过于激进，且 UI 没有倒计时/重连状态。
- `GameOverOverlay` 只接收 outcome、levelId 和 onLeave（`FE/components/game-over-overlay.tsx:5-30`），没有 matchId、结算状态、奖励流水、波次统计或“再来一次”。玩家看不到服务端已经算出的价值反馈。

### 1.4 PVP 当前状态

平台域并非空壳：

- PVP 有独立 runtime、事件历史、对观察者隐藏私有资源（`BE/src/pvp-v1/runtime.ts:400-452`），服务端每 100ms 推进（`BE/src/pvp-platform-v1/service.ts:351-357`）。
- 生产 REST 强制 OAuth 真人 session（`BE/src/network/pvp-rest-api.ts:8-18`），匹配、房间、压力、投降接口均带 requestId（`BE/src/network/pvp-rest-api.ts:100-163`）。
- 结算经 rank service 统一提交并防重复（`BE/src/pvp-platform-v1/service.ts:468-515`）。

但可玩闭环未完成：

- 前端战场组件名和 CSS 都直接标记为 `pvp-battle-skeleton`；页面只画两个空半场、核心和 HUD（`FE/pages/pvp-page.tsx:287-312`）。
- PVP 前端战中唯一玩法动作是“发送压力”和“投降”；没有招募、布阵、升级、攻击、技能或 PVE 构筑映射。
- PVP 状态每 500ms 走 REST polling（`FE/hooks/use-pvp-data.ts:365-390`），不是实时流；后台 Tab 也没有 visibility-aware 降频。
- `activateMatch` 在服务端直接把双方设 ready + loaded（`BE/src/pvp-platform-v1/service.ts:443-465`），没有真实客户端资源加载 ACK。
- 默认 `PVP_STORE=memory`（`BE/src/server.ts:94-104`），生产如果未显式配置 Supabase，赛季、战绩和结算会随进程重启丢失。
- 回放按钮只是 disabled/enabled 展示，没有点击动作（`FE/pages/pvp-page.tsx:346-348`）。

因此 PVP 应被标为“平台纵向切片/技术预览”，不可作为现阶段“完整真人竞技”对外宣传。

### 1.5 素材与构建

- `FE/public` 约 52MB，20 张 PNG 单张约 1.2–4.8MB；生产 `dist` 约 65MB。
- 素材文件使用完整生成提示作为文件名，缺少稳定 asset id、尺寸层级、版本和版权/来源 manifest。
- 代码没有引用 `/sprites/`，也没有音频文件；当前 52MB 只增加部署包体，不能改善体验。
- Phaser chunk gzip 374.15KB，主入口 gzip 236.86KB。动态分包方向正确，但战局首入仍需明确加载界面与缓存策略。

## 2. P0–P3 风险清单

### P0：阻断公开发布/付费/竞技公平

| ID | 风险 | 证据 | 必须完成的关闭条件 |
|---|---|---|---|
| P0-01 | PVP 并非完整可玩战场 | `FE/pages/pvp-page.tsx:287-312` 只有 skeleton；客户端只发压力/投降 | 完成 PVP 战斗纵向切片：加载 ACK、招募/布阵/战斗、双方公开投影、结算；至少 20 场双浏览器 E2E 无阻断 |
| P0-02 | 前端路由认证被硬编码绕过 | `FE/components/require-auth.tsx:5-8` 提前 return；主页也明确跳过登录（`FE/pages/tower-defense-frontend-page.tsx:970-976`） | 生产构建禁止 bypass；匿名访问 `/gaming`、`/pvp`、局外账户写接口均被拒绝；CI 加生产模式鉴权用例 |
| P0-03 | OAuth 缺 state 校验、会话仅内存 | `BE/src/network/oauth-routes.ts:9-18,130-180` | state 一次性、过期、绑定浏览器；session 有持久/共享存储、过期与吊销；CSRF/重放测试通过 |
| P0-04 | 生产持久化可能静默使用内存 | PVP 默认 memory（`BE/src/server.ts:94-104`）；账户库首次失败可切内存（`BE/src/data/resilient-player-account-store.ts:49-67`） | 生产 fail-closed：PVP/账户持久化未配置或不可写则健康检查失败且禁开局；演练重启后战绩、账户、结算不丢 |
| P0-05 | 结算对玩家不可见且无恢复 UX | PVE overlay 不接收奖励（`FE/components/game-over-overlay.tsx:5-30`）；PVP 结算失败只服务端 console（`BE/src/pvp-platform-v1/service.ts:509-513`） | 服务端提供 settlement status/detail 查询；客户端有 pending/success/retry/failed；重复刷新与重连不重复发奖 |

### P1：首版质量与留存高风险

| ID | 风险 | 影响与处理 |
|---|---|
| P1-01 | 没有战斗表现 | 首屏能进入但看不到攻击反馈；按第 4 节事件驱动方案完成“起手→弹道→命中→掉血→死亡”最小闭环 |
| P1-02 | PVE 高频全量 `pve` | 敌人/事件增多时产生序列化、GC、带宽和 React 重渲染；拆 `PveStatePatch + CombatEventBatch`，以 revision/event cursor 增量同步 |
| P1-03 | 没有自动化门禁 | smoke 不在 npm scripts/CI；任何模块都可能“测试存在但从未执行”；按第 3 节接入 |
| P1-04 | 数值证据不足 | 纯天兵只是一个简化策略，关 10 三档清关率结果无法证明目标区间；必须增加真实几何 bot、英雄/羁绊/装备构筑矩阵和真人 telemetry |
| P1-05 | 5 秒断线即离场结算 | Wi-Fi/4G 切换即丢局；改成可配置 30–60 秒、服务端保留席位、客户端展示倒计时和恢复快照 |
| P1-06 | Canvas 无无障碍等价路径 | 只支持指针；手机和键盘用户难以部署，屏幕阅读器无法理解战场；提供 DOM 战场摘要、键盘格游标和列表式选点 |
| P1-07 | 全局清除焦点轮廓 | `FE/app/globals.css:55-58` 对所有元素 `outline-none`，而源码几乎没有 `:focus-visible` 补偿 | 建立统一 2px focus ring，所有按钮/链接/输入可见；axe 严重错误为 0 |
| P1-08 | 素材不可直接上线 | 52MB PNG 无 atlas/压缩/manifest；先建素材管线再接入，禁止把原图直接 preload |

### P2：中期可维护性、性能与体验风险

- P2-01：战斗事件只保留最多 300 条，且全量重发；没有 `eventCursor`，重连后客户端难以区分“历史补播”和“新事件”。
- P2-02：事件是宽泛 `type: string + Record`（`shared/contracts/game.ts:392-397`），表现层无法获得编译期字段保证。应建立 discriminated union 和 `presentationVersion`。
- P2-03：PVE 客户端 `gaming-page.tsx` 同时承担协议 normalize、Socket、选择状态、动作构造和巨大 UI，变更冲突与回归面过大。
- P2-04：PVP 500ms HTTP polling 对实时战斗不够顺滑，且活动对局数上升后请求放大；转 Socket/SSE，REST 仅做补偿查询。
- P2-05：`PvpPage` 把所有路由页面放在单文件，难以按路由拆包；主入口 785KB 应继续切分。
- P2-06：已有 `prefers-reduced-motion` 只覆盖主页三个选择器（`FE/app/globals.css:1475-1481`），Boss 脉冲、匹配球和将来 VFX 没有统一降级。
- P2-07：弹窗没有 `role=dialog`、`aria-modal`、焦点圈定与 Escape；如退出确认（`FE/pages/gaming-page.tsx:1836-1847`）和 PVP surrender modal（`FE/pages/pvp-page.tsx:312`）。
- P2-08：React StrictMode 已启用（`FE/main.tsx:19-21`），Phaser 生命周期目前能 cleanup，但未来 audio/event bus 若不严格退订会出现双播放。
- P2-09：应用没有 route-level ErrorBoundary，意外异常会落到 React Router 默认错误页。

### P3：整理与长期演进

- P3-01：遗留传统塔防 state 与 PVE V2 并存，投影仍包含旧 towers/enemies/resources，增加认知和带宽负担。
- P3-02：素材名过长且混合中英文提示，部署/CDN/埋点难检索；改为稳定 id，如 `enemy_grunt_idle_v1.webp`。
- P3-03：`dist` 和截图出现在工作区，需明确哪些是发布产物、哪些是测试 artifact，避免提交噪音。
- P3-04：README 仍描述旧通用接口和静态 token（`BE/README.md:38-69`），需补生产部署、迁移、备份、报警和 QA 操作手册。

## 3. 测试金字塔、关键用例与兼容矩阵

### 3.1 建议金字塔

目标不是追求单一覆盖率，而是把“确定性规则”压在底层，把“真实浏览器/网络/存储”保留在上层。

| 层级 | 比例建议 | 工具/运行方式 | 必测对象 | PR 门禁 |
|---|---:|---|---|---|
| L0 静态 | 每次提交 | TS strict、ESLint、依赖审计、协议 schema | FE/BE/shared、不可达代码、无障碍 JSX 规则 | 0 error |
| L1 单元/属性 | 60% | Vitest 或 Node test runner + fast-check | PRNG、伤害、目标选择、数值曲线、奖励、幂等、patch merge、事件适配器 | <60s；规则覆盖 ≥90%，分支 ≥80% |
| L2 组件/场景 | 20% | React Testing Library、Phaser headless/scene harness | HUD、弹窗、结算态、键盘部署、事件→VFX recipe、对象池 | <3min；关键组件无未处理异常 |
| L3 服务集成 | 15% | 启动真实 BE + 临时 Postgres/Supabase local + Socket 客户端 | 4 人房、断线重连、CAS、结算重放、全量/patch/checkpoint、PVP 双人匹配 | <8min；所有幂等断言通过 |
| L4 浏览器 E2E/视觉 | 5% | Playwright + axe + 截图 diff | 登录→房间→选关→布阵→战斗→结算；PVP 双上下文；响应式和弱网 | Chrome 必过；阻断/严重 axe=0；视觉阈值受控 |
| L5 仿真/压测 | 夜间/发版 | Monte Carlo、k6/Artillery、长局 soak | 组合数值分布、100/500 房间、GC/内存、抖动丢包、结算恢复 | 性能预算和 SLO 全通过 |

现有 smoke 应保留，但统一注册为：`test:unit`、`test:smoke`、`test:integration`、`test:e2e`、`test:all`；禁止继续依赖开发者记忆逐个执行。`BE/tsconfig.json:16-30` 目前 include 列表也没有显式包含 account/item/weapon/pve-v2/pve-reward，应改成受控的 `src/**/*.ts` 或独立 test tsconfig，避免文件未被入口 import 时逃过 typecheck。

### 3.2 P0 关键用例

#### 权威状态与网络

1. 首次 full → 连续 patch → checkpoint，客户端 state hash 必须等于同 Tick 服务端 full hash。
2. 打乱 patch 顺序、重复包、丢 1/5/20 个包：旧 Tick 不回退，缺基线会请求 full，恢复后不重复播放历史 VFX。
3. 200ms 广播在 100ms Tick 下，事件 batch 必须不漏不重；用 `eventSeq` 连续性断言。
4. 玩家动作携带相同 requestId + 相同 payload 返回相同 receipt；相同 requestId + 不同 payload 必须冲突。
5. 4 玩家同 Tick 操作相邻格、同单位合成、固定神将迁移，验证确定性排序和 revision rejection。
6. 断线 1s/10s/30s 后恢复，玩家席位、棋盘、奖励和事件游标一致；超过宽限才离场结算。

#### PVE 战斗与数值

1. 每种天兵 1–5 级：单体/范围/穿透目标冻结、暴击、攻速、护甲计算。
2. 21 神将 × 1/3/5级：普攻、主动、被动、冷却、升级、固定/拆分。
3. 每个羁绊阈值的激活、升级、降级、解除；同 Tick 形成/拆解不重复加成。
4. Boss 每阶段：出生保护、技能 warning/cast/end、抗控上限、死亡只结算一次、插件异常隔离。
5. 召唤/区域/状态在来源消失、过期、波次完成、比赛结束时正确清理。
6. 容量临界：9→10、10→11 敌人；超载计时、解除、同步到秒、最终失败 Tick。
7. 奖励：W5/10/15/20、胜/负、离场、Boss bonus、重连、服务重启、CAS 冲突、重复 webhook/request。
8. 数值仿真不能只跑纯天兵：至少覆盖 4 类玩家 bot（新手随机、经济贪心、合成优先、羁绊/神将优先）× 10 关 × 3 难度 × 1/2/4人 × 无装/中装/毕业装。

#### PVP

1. 两真人匹配：入队、扩大区间、proposal 超时、一方确认/双方确认、取消和重放 requestId。
2. 加载 ACK：一方慢加载、失败、断线；服务器不得伪造 loaded。
3. 双方同 seed/规则版本/借用库；客户端不能读取对方私有资源或服务端 seed。
4. 遣妖不足、冷却、队列满、对方未就绪、请求重放；对双方展示一致但不泄露私密队列。
5. 投降、双亡、断线判负、硬超时、无效局；段位和奖励事务仅一次。
6. 服务重启恢复活动对局/结算，或明确将活动局安全 void 并补偿；不可静默丢局。

#### UI / 表现 / 结算

1. 每个战斗事件映射到唯一 recipe；未知事件不得崩溃，只降级为无表现 + telemetry。
2. 同一 eventId 重发不二次播放；断线全量快照不回放 300 条历史事件。
3. 低配模式最大对象数、粒子上限和音频声道限制有效；事件风暴不会无限建对象。
4. 结算 pending 时不能返回大厅导致奖励“看似丢失”；刷新结果页能恢复同一 settlement。
5. 全键盘完成：选托盘→移动格游标→部署→选单位→移动/合成→使用主动道具→退出确认。
6. reduced motion 下禁止 shake、闪屏和循环脉冲，保留颜色/图标/短淡入作为信息等价物。

### 3.3 浏览器、设备与网络兼容矩阵

| 维度 | Tier 1（每 PR/每发版） | Tier 2（每发版） | 验收重点 |
|---|---|---|---|
| Desktop | Chrome 当前/前1、Edge 当前；1920×1080、1366×768 | Firefox 当前、Safari 当前/前1；2560×1440 | Canvas、字体、WebGL、Socket、缩放 100/125/150% |
| iOS | Safari：iPhone 13/15，390×844/393×852 | iPad 10/Pro 横竖屏 | 100dvh、安全区、触摸拖放替代、音频解锁、后台恢复 |
| Android | Chrome：Pixel 7，360×800/412×915 | 中低端 Android，WebView | WebGL context、内存、纹理上限、触摸命中 ≥44px |
| 输入 | 鼠标、键盘 | 触控、触控板、手柄（若承诺） | 不依赖 hover；Canvas 有等价输入 |
| 网络 | RTT 20/120/250ms；0/1% 丢包 | 500ms、5% 丢包、断网 30s、2G 限速 | 动作确认、插值、重连、事件不重播、结算恢复 |
| 图形 | WebGL2 | WebGL1/Canvas fallback、低端核显 | 60/30fps 档位、context lost/recovered |
| 辅助功能 | 仅键盘、axe、200% zoom | VoiceOver/NVDA、高对比度 | WCAG 2.2 AA、焦点、读屏摘要、减少动态效果 |

## 4. 动画 / VFX / SFX / 镜头的事件驱动接入方案

### 4.1 原则

1. **服务端只决定事实，不决定画法。** 伤害、目标、暴击、状态、死亡由权威事件决定；颜色、粒子、弹道曲线、声音和 shake 由客户端 recipe 决定。
2. **状态与瞬时事件分离。** Snapshot 用于“现在有什么”；CombatEventBatch 用于“刚才发生了什么”。不要再从 HP 差值猜暴击或死亡。
3. **可丢表现，不可丢状态。** 网络拥塞时可以降级普通命中粒子，但不能漏最终 HP、死亡或结算。
4. **幂等播放。** `(matchId, eventSeq)` 是唯一键；客户端保留 LRU played set 和 `lastPlayedEventSeq`。
5. **插值时钟独立。** 服务端 Tick 是事实时间；客户端 render clock 延后 100–200ms 做插值，VFX 在对应 serverTick 的展示时刻触发。

### 4.2 推荐数据流

```text
PveGameRuntime
  ├─ State Snapshot / PveStatePatch ──> Client State Store ──> Phaser Entity Reconciler
  └─ CombatEventBatch(eventSeq...) ───> Event Inbox
                                          ├─ Event Deduper / Tick Scheduler
                                          ├─ PresentationRecipeRegistry
                                          ├─ VFX Pool / Projectile Pool / Floating Text Pool
                                          ├─ SFX Mixer / Music Director
                                          └─ CameraImpulseMixer
```

协议建议：

```ts
type CombatPresentationEvent =
  | { seq: number; tick: number; type: 'ATTACK_STARTED'; attackerId: string; targetIds: string[]; attackKind: string; effectId?: string }
  | { seq: number; tick: number; type: 'DAMAGE_APPLIED'; attackerId?: string; targetId: string; amount: number; critical: boolean; damageType?: string; effectId?: string }
  | { seq: number; tick: number; type: 'ENTITY_DIED'; entityId: string; killerId?: string; causeEffectId?: string }
  | { seq: number; tick: number; type: 'CAST_WARNING'; casterId: string; effectId: string; executeAtTick: number; targetIds: string[] }
  | { seq: number; tick: number; type: 'STATUS_CHANGED'; targetId: string; statusId: string; operation: 'apply'|'refresh'|'expire'; stacks: number }

interface CombatEventBatch {
  matchId: string
  presentationVersion: 1
  fromSeq: number
  toSeq: number
  events: CombatPresentationEvent[]
}
```

现有 PVE runtime 事件可以先做适配，不必重写战斗：`BASIC_ATTACK_STARTED` 已给 attacker/targets（`BE/src/pve-v2/runtime.ts:2857-2861`），`DAMAGE_APPLIED` 已给目标、伤害和暴击（`BE/src/pve-v2/runtime.ts:2973-2983`），神将技能已有 skill/effect/target（`BE/src/pve-v2/runtime.ts:1807-1824,1916-1929`）。首阶段只需增加稳定 seq 和类型安全 projection。

### 4.3 Phaser 层级与组件

建议场景层级从低到高：

1. `TerrainLayer`：静态 RenderTexture/Tilemap，关卡主题与路径。
2. `GroundDecalLayer`：范围预警、毒圈、羁绊阵纹；对象池。
3. `UnitShadowLayer`。
4. `UnitLayer`：天兵/神将/召唤物/敌人，按 y 或固定规则排序。
5. `ProjectileLayer`：箭、法球、链、激光；对象池，普通攻击最多 120 个活跃弹道。
6. `ImpactVfxLayer`：命中、暴击、破甲、死亡；粒子总量动态封顶。
7. `CombatTextLayer`：伤害/治疗/免疫，合并同目标 100ms 内的小额数字。
8. `WorldUiLayer`：血条、状态、Boss warning。
9. `ScreenFxLayer`：暗角、闪白（低强度）、Boss 入场；受 reduced motion 控制。

实体视图改为组合式 adapter：`UnitView = Sprite/Spine? + shadow + hp + status + animationState`。当前 Graphics/Text 可以作为 low-spec fallback，不应删除；在资源缺失或 WebGL context 恢复时继续保证可玩。

### 4.4 最小表现闭环（优先做）

| 事件 | 视觉 | 音频 | 镜头 | 性能降级 |
|---|---|---|---|---|
| ATTACK_STARTED | 单位 80–140ms anticipation，近战突刺/远程出射 | 按兵种限频，60ms 内同类合并 | 无 | 远处单位只播放 1 帧 squash |
| DAMAGE_APPLIED | 目标 hit flash 60ms、伤害浮字；暴击加大 | 普通 hit 随机池，暴击独立 | 暴击 0.5–1.5px impulse | 同 Tick 同目标合并数字与声音 |
| ENTITY_DIED | 停止移动、80ms hit-stop、150–300ms dissolve/碎片 | death cue | Boss 2–4px，普通无 | 屏上 >25 死亡时只淡出 |
| CAST_WARNING | 地面 telegraph + 倒计时 | 预警 loop，释放时 stop | Boss 轻微拉焦/暗角 | reduced motion 只保留高对比边框 |
| STATUS_CHANGED | 状态 tint/icon，免疫文字 | 仅强控制播放 | 无 | 最多显示 3 图标，其余聚合 |
| WAVE/BOSS | 波次横幅/Boss 名牌入场 | sting | 受控 shake/zoom | 可跳过，绝不阻塞输入 |

禁止每次 snapshot 都重新触发动画。`renderSnapshot()` 只校准实体；动画只从 event inbox 触发。死亡事件发生时先从 `lastKnownTransformByEntityId` 取位置，播完再回收视图，解决当前立即 destroy 的问题。

### 4.5 音频与镜头安全

- `AudioMixer` 分 Music/Ambience/UI/Attack/Impact/Voice 六总线；设置 master、mute、首次手势解锁和页面失焦衰减。
- 同一 sound key：建议最小间隔 50–100ms、最大并发 4；全局 SFX 最大并发 24，超出按优先级丢弃。
- 普通攻击不 shake；暴击/技能/Boss 才产生 impulse。`CameraImpulseMixer` 合并 100ms 内请求并 clamp，避免多人攻击引发眩晕。
- reduced motion：shake=0、zoom=0、hit-stop≤30ms、粒子≤25%、禁全屏闪烁；音频不必随 motion 关闭，但保留独立 mute。

## 5. Web UI、响应式、性能预算与可访问性

### 5.1 响应式信息架构

当前桌面三栏把左右 rail 高度锁定为战场高度并内部滚动（`FE/app/globals.css:1638-1678`）；≤768px 才转单栏并把战场置于长页面（`FE/app/globals.css:3500-3531`）。建议改为三档：

- ≥1280px：左“构筑/招募”、中战场、右“波次/Boss/羁绊”；允许 3 栏。
- 768–1279px：中战场优先，右 rail 变可切换抽屉/Tab；招募固定底栏。
- <768px：战场满宽置顶；底部只保留 3–5 个高频动作，详情进 bottom sheet。禁止让玩家在战斗中滚动数屏寻找招募按钮。

移动端不能依赖 HTML5 drag/drop；必须支持“点选源→点选目标”，当前业务逻辑已有点击路径，可把拖放视为桌面快捷方式。所有高频按钮触摸尺寸 ≥44×44 CSS px，战场格过小时启用局部放大/双指缩放或列表式目标选择。

### 5.2 预算（低端移动设备是基线）

| 指标 | 目标 | 硬门禁 |
|---|---:|---:|
| 首页首屏 JS（gzip） | ≤180KB | ≤250KB |
| 进入 PVE 追加 JS（gzip，含 Phaser） | ≤400KB | ≤500KB |
| 首关必须资源（纹理+音频，压缩传输） | ≤3MB | ≤5MB |
| 单张纹理 | 常规 ≤1024²；atlas 页 ≤2048² | 禁 4K 原图直传 GPU |
| LCP（4G 中档机） | ≤2.5s | ≤3.5s |
| INP | ≤150ms | ≤200ms |
| CLS | ≤0.05 | ≤0.1 |
| 战斗帧率 | Desktop p95 ≥55fps；中档移动 p95 ≥28fps | 连续 5s 不低于 24fps |
| 主线程长任务 | p95 <50ms | 单次 <100ms |
| JS heap（30 分钟） | Desktop <250MB；移动 <160MB | 10 分钟稳定段增长 <10% |
| Draw calls | 常态 <80，峰值 <120 | 峰值 <160 |
| 同屏粒子 | 高配 ≤600，低配 ≤150 | 池满即丢低优先级 |
| PVE 下行 | 常态 p95 <60KB/s/客户端 | 峰值 <150KB/s |

素材流程：原图 → 裁切透明边 → 统一逻辑尺寸 → WebP/AVIF（UI）或 atlas（运行时）→ hash manifest → 分关卡预加载。首关只载首关敌人/神将/公共 VFX；Boss 在 prep 时预取；失败回退 Graphics/Text。

### 5.3 运行时优化门禁

- `pve` 改 entity delta：pieces/enemies/statuses/summons/zones 分 revision；事件单独 batch。
- React 层只在 HUD 所需 selector 更新，不把整个 gameState 传给所有侧栏。
- Phaser view 全对象池；禁止战斗热路径创建大数组、频繁 Graphics 重画和每命中新建 Text。
- `document.visibilityState==='hidden'` 时停止渲染/降轮询，但继续低频收状态；恢复先 full/checkpoint，再继续 event cursor。
- 捕获 `webglcontextlost/restored`；恢复后重建纹理和实体，不判玩家掉线。
- 按硬件/实测 FPS 自动选择 high/medium/low，而不是让玩家先理解复杂选项。

### 5.4 可访问性验收

1. 删除全局无条件 `outline-none`，或以全局 `:focus-visible` ring 完整补偿。
2. 所有 modal 使用 `role="dialog" aria-modal="true" aria-labelledby`，打开聚焦标题/首按钮，Tab 圈定，Escape 关闭，关闭后焦点回来源。
3. Canvas 外提供 `aria-live="polite"` 的聚合战报，但不能逐个朗读每次伤害；只报波次、Boss、核心告警、技能就绪、结算。
4. 提供“战场单位列表/目标列表”作为键盘与读屏等价路径；方向键移动格游标，Enter 确认，Escape 取消。
5. 状态不能只依赖颜色：血条带数值、品质带文字/图形、可落点有图标/纹理。
6. 文本与背景达到 WCAG AA；小字大量使用 0.56–0.7rem，需在 200% zoom 和系统大字体下验证不截断。
7. reduced motion 覆盖所有 CSS animation、Phaser tween、shake、闪屏和 parallax，不只主页。

## 6. 分阶段工程依赖与验收标准

### Phase 0：发布地基与 QA 门禁（1 个迭代）

依赖：无；所有后续阶段的入口。

工作包：

- 恢复生产认证，修 OAuth state/session，生产持久化 fail-closed。
- 建统一 test scripts 与 CI；纳入现有 13 组 smoke。
- 定义 `CombatPresentationEvent v1`、`eventSeq`、PVE entity revision/patch。
- 建性能 telemetry：客户端 FPS/heap/context lost、网络 bytes、服务端 tick/projection/settlement latency。

验收：

- FE/BE build、lint、unit、smoke 自动运行；失败阻断合并。
- 匿名无法进入受保护页面或写账户；OAuth 重放/state 错配失败。
- 生产缺持久化配置时拒绝 Ready/开局。
- full/patch/checkpoint 在丢包与乱序测试后 state hash 一致。

### Phase 1：PVE 战斗表现纵向切片（1–2 个迭代）

依赖：Phase 0 事件协议、素材 manifest、基础对象池。

范围：只做首关 + 4 天兵 + 1 神将 + 1 Boss，完成攻击到死亡全链路；Graphics fallback 保留。

验收：

- 起手、弹道/近战、命中、暴击、死亡、状态、Boss warning、波次横幅、SFX、有限 shake 均由 event 驱动。
- 同一 event 重发 10 次只播放一次；重连不回放历史。
- 中档移动 4 人/40 敌人 p95 ≥28fps；Desktop p95 ≥55fps；无持续内存增长。
- reduced motion 和 mute 生效；资源失败仍可完整操作。

### Phase 2：PVE UI、奖励结算与响应式（1 个迭代）

依赖：Phase 1 表现层；服务端 settlement detail/status API。

范围：战中 HUD 重排、移动底栏、Boss/波次信息层级、结算统计与奖励揭示。

验收：

- 结算展示胜负原因、最高波、关键统计、里程碑奖励、武器碎片/金币变化、结算状态、再来一局/返回。
- 刷新/重连恢复同一结算；结算失败可安全重试且不重复发奖。
- 360×800 至 2560×1440 无阻断、无横向溢出；关键动作始终 1 次点击可达。
- axe 阻断/严重问题为 0；纯键盘可完成一局核心操作。

### Phase 3：数值验证与内容扩展（持续 2–3 个迭代）

依赖：Phase 0 telemetry、Phase 2 完整玩家漏斗。

范围：仿真 bot、构筑矩阵、真人小流量、关卡参数热配置与版本快照。

验收：

- 每关/难度有目标清关率、时长、失败波次和构筑多样性区间；样本不足明确标注，不用均值冒充结论。
- 新手简单 1 目标首局清关率 70–80%；普通为熟练玩家主线；困难按毕业构筑评估，不再用纯天兵 0% 作为唯一证据。
- 任一单神将/单羁绊在同等养成下的选取率、伤害贡献、胜率不长期统治；超阈值自动报警。
- 每次 balanceVersion 可复现旧回放，回滚无需发客户端版本。

### Phase 4：PVP 真正可玩纵向切片（至少 2 个迭代）

依赖：PVE 表现系统可复用、生产持久化、实时网络协议、竞技构筑冻结。

范围：先自定义 1v1，再休闲，最后排位。不要三者同时开放。

验收：

- 客户端真实 loaded ACK；双方能招募、布阵、防守、遣妖并看到公开战斗。
- 状态改用 Socket/SSE 实时流，REST 只补偿；120ms RTT 下操作反馈可接受，250ms 可玩。
- 20 场双浏览器自动 E2E + 100 场 bot soak 无状态分叉、无重复结算。
- 服务重启演练不丢战绩；作弊客户端无法改 HP、资源、伤害、seed 或对手私有信息。
- 自定义验收稳定后才开休闲；休闲稳定和数值冻结后才开排位。

### Phase 5：全量内容、低端优化与运营化（持续）

依赖：Phase 1–4 指标稳定。

验收：

- 全 21 神将、全部 Boss/道具/武器都有表现 recipe 和 fallback。
- 素材首局预算、FPS、heap、带宽全部达标；低端档自动降级。
- 崩溃、结算失败、Socket 重连、Tick 延迟、WebGL context lost 有 dashboard 和报警。
- 发版具备 canary、回滚、balance 配置回滚、数据库备份恢复演练。

## 7. 建议模块负责人拆分与接口边界

| 模块 | 可独立交付物 | 前置接口 | 禁止越界 |
|---|---|---|---|
| QA/协议 | test scripts、CI、event schema、hash/乱序测试 | shared contracts | 不修改战斗数值结论 |
| 网络同步 | PveStatePatch、event batch/cursor、重连 | GameEngine snapshot/event | 不把表现配置写进服务端规则 |
| Phaser Core | entity reconciler、pool、clock、layers、fallback | snapshot + typed events | 不从 HP diff 猜战斗事实 |
| VFX/Animation | recipe registry、天兵/神将/Boss 动画 | stable asset/effect id | 不直接订阅 Socket，不修改 React state |
| Audio/Camera | mixer、限频、impulse、设置 | presentation recipe | 普攻禁止无上限 shake/SFX |
| Web UI | HUD、响应式、键盘、modal、结算页 | selector + settlement API | 不复制服务端奖励算法 |
| Balance/Data | bot、Monte Carlo、telemetry、版本 | deterministic runtime | 不用单一纯天兵模型宣布平衡 |
| PVP Vertical | real-time projection、双战场、竞技结算 | 复用表现层 + persistence | 排位不得先于自定义/休闲验收 |

## 8. Definition of Done（全项目统一）

一个“增强玩家体验”的功能只有同时满足以下条件才算完成：

1. 有服务端/客户端明确数据归属与版本；未知版本安全降级。
2. 有单元或属性测试；玩家主路径有集成/E2E。
3. 重复请求、重连、刷新、乱序和超时已验证。
4. 有高/中/低性能档与 reduced motion fallback。
5. 键盘、触摸和鼠标至少有等价核心操作；焦点可见。
6. 性能指标在预算内，未以“看起来流畅”代替数据。
7. 埋点能回答：玩家是否看到、是否理解、是否成功、为何失败。
8. 结算/奖励/段位只由服务端决定，客户端永不估算权威结果。
9. 文档记录依赖、开关、回滚和异常处理。
10. 产品、设计、工程、QA 共同通过可操作验收，不以“编译通过”代替完成。

---

## 附录 A：本次验证命令与结果

```text
FE: pnpm build                                      PASS
BE: pnpm check && pnpm build                        PASS
BE: ts-node src/pve-v2/smoke.ts                     PASS
BE: ts-node src/pve-v2/balance-smoke.ts             PASS
BE: ts-node src/pve-v2/boss-runtime-smoke.ts        PASS
BE: ts-node src/pvp-v1/smoke.ts                     PASS
BE: ts-node src/pvp-platform-v1/http-smoke.ts       PASS
BE: ts-node src/pve-reward-v1/smoke.ts              PASS
BE: ts-node src/item-v1/smoke.ts                    PASS
BE: ts-node src/weapon-v1/smoke.ts                  PASS
BE: ts-node src/core/hero-v1/full-catalog-smoke.ts  PASS
BE: ts-node src/synergy-v1/smoke.ts                 PASS
BE: ts-node src/matchmaking-v1/smoke.ts             PASS
BE: ts-node src/rank-v1/smoke.ts                    PASS
BE: ts-node src/account-v1/smoke.ts                 PASS
```

注意：这些 PASS 证明当前断言没有回归，不证明真实浏览器、真实 Supabase、生产 OAuth、长局、弱网、视觉或无障碍达标；这些正是本规划要补齐的门禁。
