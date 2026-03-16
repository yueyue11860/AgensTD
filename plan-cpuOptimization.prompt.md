你要对 AgensTD 做一次面向联调与正式运行时的 CPU 全链路优化。

目标
- 在不依赖明显降频的前提下，显著降低本地联调和正式运行时的 CPU 占用。
- 优先修复真实运行时热点，不用“把 tick 调慢”来掩盖问题。
- 保持现有核心玩法和实时性语义不变，避免行为回归。

硬约束
- 不把降低 tickRateMs 或 broadcastIntervalMs 作为主要方案。
- 前端允许使用“丢弃陈旧帧、保留最新状态”的背压策略，但不能明显恶化交互实时性。
- StrictMode 不是第一优先级，除非观测证明它是主要来源。
- Replay 与 Agent SSE 在优化范围内，不能忽略。

优先处理顺序
1. 建立性能观测基线。
2. 修复后端确定性热点。
3. 收敛后端重复投影与重复监听器开销。
4. 收敛前端高频消息导致的渲染风暴。
5. 最后再优化开发启动链路与 watch/编译成本。

必须完成的工作
1. 在后端增加轻量性能观测，至少覆盖以下指标：
- tick 总耗时
- 各 onTick 监听器耗时
- 投影耗时
- 广播次数与消息大小
- SSE 连接数或监听器数量
- replay flush 耗时

2. 修复后端热点：
- 重点检查并修复 BE/src/core/entities/enemy.ts 中 cleanse trait 的 while 循环 busy loop。
- 复核敌人路径推进逻辑，避免单 tick 中出现异常高迭代开销。

3. 重构 tick 后的数据分发：
- 目前 Socket、Agent SSE、ReplayRecorder 不应各自重复计算 projectFrontendGameStatePatch、projectFrontendUiStateUpdate、projectFrontendNoticeUpdate。
- 改成“每个 tick 只投影一次”的共享 pipeline 或缓存层。
- Socket、SSE、Replay 都复用同一份投影结果。

4. 重构监听器职责：
- 提升 GameEngine onTick 链路的可观测性。
- 避免每个 SSE 连接重复触发完整投影。
- 至少能看见当前 listener 数量，并能确认不存在重复订阅放大问题。

5. 优化广播门控顺序：
- 先判断当前 tick 是否需要广播。
- 只有需要广播时才计算 patch、ui update、notice update。
- finished 状态保留最终广播。

6. 收敛前端更新风暴：
- 在 FE/hooks/use-game-engine.ts 中加入客户端背压，只保留最新状态，避免旧 patch 堆积。
- 减少高频 socket 消息直接触发整页重渲染。
- 切开战场态与竞赛态的渲染传播边界，避免排行榜/回放刷新带着 GameMap 和 Sidebar 一起重渲染。

7. 做组件级渲染隔离：
- 检查并优化 FE/components/game-map.tsx 的更新粒度。
- 为 competition-panels、game-resources、game-sidebar 建立清晰 memo 边界。
- 必要时把大对象 gameState 拆成更稳定的派生 props。

8. 调整竞赛数据刷新模型：
- use-competition-data 改成 Realtime 触发按需拉取。
- 页面不可见时不做不必要刷新。
- 正在加载时避免重复请求叠加。

9. 优化开发链路，但放在最后：
- 调整 dev-stack.sh、BE/package.json、BE/tsconfig.json、FE/vite.config.ts、FE/tsconfig.json。
- 降低 ts-node/watch/Vite/shared include 的开发期开销。
- 这部分是增益项，不替代运行时修复。

重点文件
- dev-stack.sh
- BE/package.json
- BE/tsconfig.json
- BE/src/core/game-loop.ts
- BE/src/core/game-engine.ts
- BE/src/core/entities/enemy.ts
- BE/src/network/socket-gateway.ts
- BE/src/network/agent-api.ts
- BE/src/core/replay-recorder.ts
- FE/hooks/use-game-engine.ts
- FE/hooks/use-competition-data.ts
- FE/pages/tower-defense-frontend-page.tsx
- FE/components/game-map.tsx
- FE/components/competition-panels.tsx
- FE/components/game-resources.tsx
- FE/components/game-sidebar.tsx
- FE/vite.config.ts
- FE/tsconfig.json

执行要求
- 先做最小必要观测，再根据数据下手，不要盲改。
- 优先修根因，不做表面补丁。
- 保持改动集中，避免顺手重构无关模块。
- 如果发现某个热点并非主要瓶颈，快速收缩范围，转向更高收益项。

验收标准
1. 后端新增客户端后，CPU 不再随连接数近线性放大。
2. 开启 Agent SSE 后，不再重复增加完整投影开销。
3. 浏览器主线程占用和 React 高频 commit 明显下降。
4. 联调时建塔、升级、出售、波次推进、结算、排行榜、回放都无行为回归。
5. 连续运行 10 到 15 分钟后，CPU、内存、日志量没有持续爬升。

输出要求
- 先给出基线观测结果和你确认的主要瓶颈。
- 然后按实施顺序完成修改。
- 最后给出优化摘要、剩余风险和验证结果。
