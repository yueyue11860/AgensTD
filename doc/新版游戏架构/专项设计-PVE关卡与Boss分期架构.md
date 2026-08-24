# 专项设计：PVE 关卡与 Boss 分期架构

> 状态：V0.1，关卡与 Boss 的分期开发依据  
> 当前目标：先搭建可扩展的 20 波框架，并只实现前 5 波与第一个 Boss 纵向切片  
> 权威边界：本文件只定义关卡编排、分路波次、Boss 插件和阶段完成；天兵/普通小怪数值、战斗公式、掉落内容与局外结算由对应专项负责

## 1. 结论与不可改变的边界

1. 继续复用原项目 29×29 战场、P1～P4 槽位、四条出生路线和公共循环圈，不重做战场拓扑。
2. 每位玩家只负责一条出生路线。怪物处于本路私有段时，只能被路线主人攻击；进入公共循环圈后，才可被其他玩家攻击。
3. 普通小怪严格只有生命、护甲、魔抗、基础移动速度四项战斗属性，不携带技能。
4. 普通小怪的基础移动速度不随波次成长。只有 Boss 技能产生的有期限效果可以临时提高其当前移动速度。
5. 单关目标结构为 20 波，第 5、10、15、20 波是 Boss 节点；这表示单人一关经历 4 个 Boss 节点。多人时同一 Boss 模板默认在每条有效路线各生成一只实例，保证每名玩家仍先守自己的本路。
6. 第一版不要求一次开发完 20 波与 4 个正式 Boss。先完成前 5 波、通用 Boss 插件壳和一个占位 Boss，再按 10/15/20 波逐段扩展。
7. 击杀收益归最后有效伤害玩家；出生路线不预绑定斋饭或经验。路线主人另按独立清波条件获得 `5 × 波次` 斋饭保底。

## 2. 从原项目保留的成熟能力

### 2.1 直接复用

- `Room` 的最多四人房间、P1～P4 固定槽位和玩家到槽位映射。
- `arena-layout.ts` 的 29×29 棋盘、`WAYPOINTS_MAP`、四个出生点和公共循环路径。
- `EngineLaneRoute` 的 `spawn`、`path`、`loopStartIndex` 结构。
- 服务端 Tick、房间内串行动作队列、Socket 推送、快照与性能监控技术壳。
- 路径到达末端后回到 `loopStartIndex` 的循环行为。

### 2.2 需要替换或扩展

- 现有 `WaveManager` 用 `spawnMultiplier × count` 后轮转路线的方式，无法表达每路独立生成、每路清波和每路即时低保；新版改为显式的“每路刷怪运行时”。
- 现有波次在出怪结束后立即进入下一波，只有最后一波等待全图清空；新版默认每波都要等本波所有有效路线完成清场后再推进。
- 旧 `EnemyKind`、旧怪物技能/护盾/分裂等配置不能进入普通小怪 V2。
- 旧金币与 `findRewardOwner()` 的首玩家兜底必须删除。没有合法最后伤害玩家的环境击杀不产生击杀斋饭或神将经验。
- Boss 不能通过在引擎里不断增加 `if (bossId === ...)` 实现，必须由版本化插件驱动。

## 3. 四人战场拓扑

### 3.1 路线分段

现有每条 `EngineLaneRoute` 保留以下含义：

```ts
interface PveLaneRouteSnapshot {
  slotId: 'P1' | 'P2' | 'P3' | 'P4';
  ownerPlayerId: string;
  spawn: BoardPosition;
  path: readonly BoardPosition[];
  publicLoopEntryIndex: number; // 由现有 loopStartIndex 固化进配置快照
}
```

- `[0, publicLoopEntryIndex)`：玩家私有守线段。
- `[publicLoopEntryIndex, path.length)`：公共循环圈段。
- 怪物走到路径末端后回到 `publicLoopEntryIndex`，并将 `lapCount + 1`，不会重新进入任一玩家私有段。
- `publicLoopEntryIndex` 属于地图配置，不允许关卡脚本或 Boss 动态修改。

运行时必须显式保存：

```ts
type RouteZone = 'private_lane' | 'public_loop';

interface PveEnemyRouteRuntime {
  homeLanePlayerId: string;
  homeSlotId: 'P1' | 'P2' | 'P3' | 'P4';
  pathIndex: number;
  pathProgressMilli: number;
  lapCount: number;
  routeZone: RouteZone;
}
```

`routeZone` 由权威路径位置推导，并在跨过入口时产生一次 `ENEMY_ENTERED_PUBLIC_LOOP` 事件。它不能由客户端上报。

### 3.2 跨玩家攻击资格

```text
private_lane：attacker.ownerPlayerId 必须等于 enemy.homeLanePlayerId
public_loop：任意仍在对局中的玩家都可攻击
```

几何射程与上述所有权条件必须同时满足。即使其他玩家的攻击范围在几何上覆盖私有段，也不能提前抢怪；进入公共循环圈后不再保留攻击独占权。

目标选择层读取 `routeZone` 做资格过滤，关卡层不改伤害公式。未来全屏技能、召唤物和控制效果是否遵守同一私有段限制，由统一效果系统逐项注册；没有明确声明时默认遵守。

### 3.3 有效路线集合

- 房间开始并锁定配置时，根据实际玩家形成 `activeLanePlayerIds` 和稳定的 P1→P4 顺序。
- 本波普通组和 Boss 组默认对每条有效路线各生成独立实例，不使用“总数乘人数后轮转”的隐式算法。
- 临时断线且仍在重连宽限期的玩家，其路线继续生成和推进。
- 玩家永久退出后不再参加后续波次的有效路线集合；退出前已经生成的怪物继续存在并可在公共循环圈被队友清理。
- 永久退出发生在当前波中途时，该路线当前波不再追加尚未生成的怪物，记录 `retiredAtTick`；已生成怪清空后只解除房间推进阻塞，不再向已结算退出玩家补发清波奖励。

## 4. 关卡配置 Schema

时间全部使用 Tick，概率和倍率全部使用基点，运行时禁止解析自然语言描述。

```ts
interface PveStageDefinitionV1 {
  schemaVersion: 1;
  stageId: string;
  configVersion: string;
  displayName: string;
  sceneId: string;
  boardLayoutId: 'arena_29x29_v1';
  routeSetId: 'arena_p1_p4_loop_v1';
  minPlayers: 1;
  maxPlayers: 4;
  waveCount: 20;
  bossWaveNumbers: readonly [5, 10, 15, 20];
  defaultWaveAdvancePolicy: 'after_all_active_lanes_cleared';
  defeatRuleRef: string;
  waveDefinitions: readonly PveWaveDefinitionV1[];
  settlementPolicyRef: 'settlement_v1';
}

interface PveWaveDefinitionV1 {
  waveNumber: number;
  prepTicks: number;
  spawnGroups: readonly LaneSpawnGroupV1[];
  ordinaryScalingRef?: string;
  bossNode?: BossNodeDefinitionV1;
}

interface LaneSpawnGroupV1 {
  groupId: string;
  entityKind: 'ordinary_minion' | 'boss';
  entityDefinitionId: string;
  spawnScope: 'per_active_lane';
  countPerLane: number;
  startOffsetTicks: number;
  intervalTicks: number;
}

interface BossNodeDefinitionV1 {
  ordinal: 1 | 2 | 3 | 4;
  bossDefinitionId: string;
  spawnScope: 'per_active_lane';
  blocksWaveCompletion: true;
}
```

### 4.1 配置校验

加载关卡前必须拒绝以下配置：

- `waveDefinitions` 不是从 1 开始连续递增或存在重复波次。
- 正式完整关不是 20 波，或 Boss 节点不在 5/10/15/20。
- Boss 节点没有且仅有一个 `entityKind = boss` 的生成组。
- 普通小怪组引用的定义包含技能、非四属性或波次移速倍率。
- `countPerLane <= 0`、负延迟、非正整数间隔或非整数 Tick。
- 关卡脚本直接填写局外金币、购买权，或绕过奖励/结算专项发奖。
- 配置引用的地图、路线、怪物、Boss 插件或参数快照不存在。

内部开发切片可以声明 `developmentWaveLimit: 5 | 10 | 15`，但不得伪装成正式 20 波关卡。该字段只存在于开发环境清单，不进入线上关卡定义。

### 4.2 普通怪波次成长边界

- `ordinaryScalingRef` 只能解析出生命倍率、护甲加值、魔抗加值。
- 普通怪的 `baseMoveSpeedMilliCellsPerSecond` 只从怪物定义读取，波次配置不得覆盖。
- 场景字池和普通怪数值由《小怪与波次基础架构.md》及天兵/小怪数值专项给出，本专项只引用 ID。
- Boss 使用独立定义与调参引用，不继承普通怪波次成长公式。

## 5. 波次状态机与每路完成判定

### 5.1 房间波次状态

```ts
type PveWavePhase = 'prep' | 'spawning' | 'clearing' | 'completed';

interface PveWaveRuntimeV1 {
  waveNumber: number;
  phase: PveWavePhase;
  phaseStartedAtTick: number;
  activeLanePlayerIdsAtStart: readonly string[];
  groupRuntimes: Record<string, LaneSpawnGroupRuntime>;
  laneProgress: Record<string, LaneWaveProgressV1>;
}
```

- `prep`：等待本波准备时间。
- `spawning`：各有效路线按相同脚本、独立计数生成。
- `clearing`：所有仍有效生成组均已结束，但至少一条路线仍有本波存活实体。
- `completed`：所有未永久退出的有效路线均完成；持久化检查点后进入下一波准备阶段。

第一版不允许波次重叠。下一波只能在当前波达到 `completed` 后开始，避免同一怪物归属波次不清、清波低保提前发放和 Boss 节点被后续怪潮掩盖。

### 5.2 每路波次状态

```ts
interface LaneWaveProgressV1 {
  playerId: string;
  slotId: 'P1' | 'P2' | 'P3' | 'P4';
  waveNumber: number;
  plannedSpawnCount: number;
  spawnedCount: number;
  aliveEntityIds: readonly string[]; // 服务端可用 Set，快照序列化为稳定数组
  spawningCompleted: boolean;
  retiredAtTick?: number;
  clearedAtTick?: number;
  clearRewardSettlementId?: string;
}
```

一条路线仅在下列条件同时满足时完成：

```text
spawningCompleted = true
AND spawnedCount = plannedSpawnCount（永久退出路线按退休后冻结的计划数）
AND aliveEntityIds.size = 0
```

- 怪物进入公共循环圈后仍保留原 `homeLanePlayerId`，继续计入原路线的 `aliveEntityIds`。
- 队友在公共循环圈击杀它，会正常从原路线存活集合移除。
- Boss 实例也进入其出生路线集合；Boss 未死亡时该路线不能清波。
- 满足条件的 Tick 立即产生 `LANE_WAVE_CLEARED`，不等待其他路线。
- 房间波次完成条件是所有当前非退休有效路线均已完成，且所有退休路线已生成的遗留实体也已经清空。

### 5.3 低保发放顺序

路线清波事件与斋饭低保在同一房间 Tick 内按 P1→P4 稳定顺序结算：

```text
rewardRice = 5 × waveNumber
settlementId = matchId + ':lane-clear:' + playerId + ':' + waveNumber
```

先完成者先收到奖励，可以在其他玩家仍清怪时使用该斋饭进行征兵和调整阵容。幂等账本已经存在时只返回原事件，不再次增加斋饭。

## 6. Boss 定义与插件边界

### 6.1 Boss 静态定义

```ts
interface BossDefinitionV1 {
  bossDefinitionId: string;
  glyph: string;
  displayName: string;
  statsRef: string;
  controlProfileRef: string;
  rewardProfileRef: string;
  skillPlugins: readonly BossSkillPluginBindingV1[];
}

interface BossSkillPluginBindingV1 {
  bindingId: string;
  pluginId: string;
  pluginVersion: number;
  tuningRef: string;
}
```

`statsRef`、控制抗性和 Boss 击杀奖励由后续数值专项填写。本文件不预设 Boss 生命、护甲、魔抗、经验、斋饭或碎片概率。

### 6.2 插件接口

Boss 插件只能读取只读上下文并返回结构化命令，不得直接修改 `MatchStateV2`、直接发奖或调用网络接口。

```ts
interface BossSkillPluginV1<TConfig, TState> {
  readonly pluginId: string;
  readonly pluginVersion: number;
  validateConfig(config: unknown): TConfig;
  createInitialState(context: Readonly<BossSpawnContext>, config: TConfig): TState;
  reduce(
    state: Readonly<TState>,
    event: Readonly<BossRuntimeEvent>,
    context: Readonly<BossRuntimeContext>,
    config: Readonly<TConfig>,
  ): BossPluginResult<TState>;
}

interface BossPluginResult<TState> {
  nextState: TState; // 必须为可序列化纯数据
  commands: readonly BossEffectCommand[];
}

type BossRuntimeEvent =
  | { type: 'BOSS_SPAWNED'; tick: number }
  | { type: 'TICK'; tick: number }
  | { type: 'HP_THRESHOLD_CROSSED'; tick: number; thresholdBps: number }
  | { type: 'LAP_COMPLETED'; tick: number; lapCount: number }
  | { type: 'BOSS_DAMAGED'; tick: number; sourcePlayerId: string; appliedDamage: number }
  | { type: 'BOSS_DIED'; tick: number; killerPlayerId: string | null };

type BossEffectCommand =
  | ApplyTemporaryMoveSpeedModifier
  | EmitBossTelegraph
  | EmitRegisteredStructuredEffect;
```

第一阶段只开放两个命令：

1. `EMIT_BOSS_TELEGRAPH`：产生可回放的预警表现事件，不改变战斗状态。
2. `APPLY_TEMPORARY_MOVE_SPEED_MODIFIER`：对明确目标集合施加有期限、可追溯来源的移速倍率。

其他伤害、召唤、护盾、控制、地图机关等命令必须等统一效果系统注册后逐项加入白名单，不能让插件以自由脚本绕过结算顺序。

### 6.3 Boss 移速增益约束

```ts
interface ApplyTemporaryMoveSpeedModifier {
  type: 'APPLY_TEMPORARY_MOVE_SPEED_MODIFIER';
  commandId: string;
  sourceBossEntityId: string;
  target: 'self' | 'ordinary_minions_same_home_lane';
  multiplierBps: number;
  durationTicks: number;
  stackingGroup: 'boss_move_speed_buff';
}
```

- 只能改变 `currentMoveSpeedMilliCellsPerSecond`，不能改写普通怪基础移速。
- 到期后恢复根据基础移速和仍存续效果重新计算的当前移速。
- 同组多效果第一版取最高倍率、持续时间分别计时，不做乘法叠加。
- 插件只能影响自己的出生路线；跨全场加速需未来单独注册，避免一名玩家的 Boss 随意改变其他玩家压力。
- Boss 死亡时由该 Boss 产生的临时移速效果立即移除。
- 命令参数必须通过范围校验；具体倍率和持续时间来自 `tuningRef`，不得写死在插件代码。

### 6.4 插件执行顺序与安全性

- 同 Tick 按 Boss `homeSlotId`、`spawnSequence`、`entityId` 稳定顺序调用。
- 单个 Boss 的插件按绑定数组顺序执行；命令先收集，后由效果系统统一验证并应用。
- 插件不得使用系统时间、网络、文件、无种子随机或闭包状态。
- 随机只能申请由 `matchSeed + bossEntityId + pluginBindingId + eventSequence` 派生的确定性随机流。
- 插件异常时记录 `BOSS_PLUGIN_FAILED` 并停用该绑定，不能让整个房间 Tick 崩溃；是否因此判定该局异常补偿由运营/结算策略决定。
- Boss 插件状态必须能 JSON 序列化，并包含在检查点哈希中。

## 7. 第一个 Boss 占位模板

第 5 波 Boss 先用于验证插件生命周期，不在本文件臆造正式数值和西游角色能力。

```ts
const FIRST_GATE_BOSS_PLACEHOLDER: BossDefinitionV1 = {
  bossDefinitionId: 'boss_wave05_placeholder_v1',
  glyph: '王',
  displayName: '五波守门首领（占位）',
  statsRef: 'boss_wave05_stats_tbd',
  controlProfileRef: 'boss_basic_control_profile_tbd',
  rewardProfileRef: 'boss_wave05_reward_tbd',
  skillPlugins: [
    {
      bindingId: 'lane_haste_window',
      pluginId: 'boss.periodic_lane_haste.v1',
      pluginVersion: 1,
      tuningRef: 'boss_wave05_lane_haste_tbd',
    },
  ],
};
```

插件行为模板：

1. Boss 出生后按参数等待。
2. 产生一次可见预警。
3. 预警结束后，临时提高同出生路线存活普通小怪的当前移速。
4. 效果到期或 Boss 死亡时移除。
5. 按参数进入下一轮周期。

所有 `*_tbd` 引用在数值专项提供并通过配置校验前，该模板不得被线上关卡加载。这样可以先实现插件协议和自动化测试，不提前拍定 Boss 强度。

## 8. 奖励与局外结算边界

### 8.1 普通击杀

- 最后一次造成有效伤害的 `sourcePlayerId` 是击杀玩家。
- 击杀玩家获得该普通怪 1 斋饭，并取得该怪 1000 点神将经验的结算权。
- 队友进入公共循环圈后补刀，收益归队友；这是允许的合作战术。
- 无合法玩家来源的环境伤害不产生击杀斋饭和神将经验。

### 8.2 Boss 击杀

- Boss 的最后有效伤害玩家仍是击杀玩家。
- Boss 具体斋饭、经验、武器碎片掉落读取 `rewardProfileRef`，本专项不填写数值。
- Boss 插件不能发奖；统一死亡结算器只允许以 `deathSettlementId = matchId + bossEntityId` 入账一次。

### 8.3 本路清波低保

- 第 `n` 波清完后，路线主人获得 `5n` 斋饭。
- 本路怪由谁击杀不改变该奖励；只要本路该波完成出怪且出生实体全部死亡，就立即发放。
- 击杀奖励和低保奖励是两套独立账本，分别允许补刀战术和弱势追赶。

### 8.4 退出、失败和通关

- `highestCompletedWave` 只在该玩家取得 `LANE_WAVE_CLEARED` 后推进。
- 永久退出结算一经提交，不接收迟到的清波、击杀或掉落奖励。
- 0～4、5～9、10～14、15～19 与通关档奖励，全部引用《专项设计-局外结算与购买权.md》，关卡脚本不得复制一份奖励表。
- 正式胜利要求第 20 波完成、场上所有敌对实体清空、房间没有先进入失败状态；不能仅以某位玩家 `highestCompletedWave = 20` 判胜。
- 失败条件继续引用关卡 `defeatRuleRef`。当前既有“同屏怪物达到容量并持续 10 秒”可作为首版策略，但容量数值与未来失败方式不写死在 Boss 插件中。

## 9. 重连、回放和配置版本

### 9.1 配置清单

`MatchManifest` 至少增加：

- `stageDefinitionHash`
- `boardLayoutHash`
- `routeSetHash`
- `ordinaryEnemyConfigHash`
- `bossDefinitionsHash`
- 每个 `pluginId + pluginVersion + pluginBundleHash`
- 全部 `statsRef / tuningRef / rewardProfileRef` 的解析后快照哈希

线上对局开始后禁止热更上述配置。插件修复必须提升版本，只影响新房间。

### 9.2 检查点

完整检查点必须包含：

- 房间波次阶段、当前 Tick、各生成组的计划数/已生成数/下次生成 Tick。
- 每条路线的出生实体 ID 集合、清波状态和低保结算 ID。
- 所有普通怪与 Boss 的路径段、路径进度、圈数、生命和当前效果。
- 每个 Boss 插件绑定的序列化状态、已经发出的命令 ID、待到期效果。
- 击杀、死亡、清波和结算幂等账本摘要。

### 9.3 回放事件

至少记录：

- `WAVE_PREP_STARTED`
- `WAVE_STARTED`
- `ENEMY_SPAWNED`
- `ENEMY_ENTERED_PUBLIC_LOOP`
- `BOSS_PLUGIN_COMMAND_EMITTED`
- `TEMPORARY_SPEED_MODIFIER_APPLIED/EXPIRED`
- `ENEMY_DIED`
- `LANE_WAVE_CLEARED`
- `LANE_CLEAR_RICE_GRANTED`
- `WAVE_COMPLETED`
- `MATCH_FINISHED`

恢复或回放时不重新播放已经影响状态的旧命令，而是从检查点状态继续；从头重放时则按事件序列和相同插件版本重新推演，并在检查点比较哈希。

## 10. 分期开发顺序

### 阶段 A：前 5 波纵向切片

- 迁移 P1～P4 私有段/公共循环圈，落实跨玩家攻击资格。
- 新建每路刷怪计数和每路独立清波状态。
- 跑通普通小怪四属性、前 1～4 波和第 5 波 Boss 生成。
- 完成 `5n` 清波低保、最后伤害击杀收益和本路/击杀双幂等账本。
- 实现 Boss 插件注册表、序列化状态、预警和临时同路加速命令。
- 使用占位 Boss 做协议测试，正式数值由天兵/小怪数值专项校准后补入。

### 阶段 B：扩到第 10 波

- 增加第 6～10 波脚本与第二 Boss 定义。
- 接入最基础的 Boss 控制抗性配置。
- 验证两轮 Boss 之间的经济、神将经验和多人救场节奏。

### 阶段 C：扩到第 15 波

- 增加第 11～15 波和第三 Boss。
- 在统一效果系统已稳定的前提下，开放一个新的白名单 Boss 命令类型。
- 完成中后期性能压测、重连与长回放哈希验证。

### 阶段 D：完成第 20 波

- 增加第 16～20 波与终局 Boss。
- 接入正式通关、武器碎片掉落及局外结算事务。
- 完成四人全流程、永久退出、失败与通关边界验收。

### 阶段 E：内容扩展

- 按花果山、盘丝洞、火焰山等场景增加字池、波次模板和 Boss 插件组合。
- 逐个 Boss 专项调优，禁止通过复制整个引擎逻辑制造分叉。
- PVP 不复用本文件的 20 波完成节奏，只复用底层敌人、路径和结构化效果能力。

## 11. 验收标准

### 11.1 拓扑与攻击

- 1～4 人分别正确绑定 P1～P4；同种子下路线与出生顺序可复现。
- 怪物在私有段时，其他玩家即使几何射程覆盖也不能命中。
- 怪物跨过公共入口后，其他玩家可以正常选中、补刀并取得击杀收益。
- 路径末端回到公共入口，`lapCount` 正确增加且不会回到私有段。

### 11.2 波次与奖励

- 每条有效路线按 `countPerLane` 独立生成，不依赖总数轮转巧合。
- 本路完成出怪但仍有怪在公共圈时不发低保；最后一个本路怪死亡的同 Tick 发放。
- 同一波四名玩家可在四个不同 Tick 分别收到 `5n`，每人最多一次。
- 队友补刀取得该怪击杀斋饭/经验结算权，路线主人仍取得自己的清波低保。
- 当前波没有完成全路清场时下一波不能开始；完成后只推进一次。

### 11.3 普通怪与 Boss

- 普通怪只有生命、护甲、魔抗、基础移速，波次不会改变基础移速。
- Boss 临时加速效果只修改同路目标的当前移速，超时或 Boss 死亡后正确恢复。
- Boss 未死亡时其出生路线不能清波；Boss 死亡只结算一次。
- 未注册插件命令、缺失调参引用和非确定性插件均在关卡加载或运行时被拒绝/隔离。

### 11.4 重连与回放

- 在出怪中、Boss 技能预警中、临时加速中和某一路刚领奖后断线，重连快照均可恢复一致状态。
- 从相同 Manifest、种子和动作序列重放，生成路线、Boss 命令、击杀、清波和最终结果哈希一致。
- 永久退出路线不再生成后续怪物；已有怪清空不会向已结算玩家迟到发奖，也不会永久卡住房间。

## 12. 与其他专项的接口

- 普通怪定义与波次三项成长：《小怪与波次基础架构.md》。
- 天兵和普通怪具体数值校准：《小兵体系架构.md》及《专项设计-天兵与小怪数值平衡.md》。
- 普攻、最后伤害和死亡顺序：《专项设计-基础战斗事件与直接攻击.md》。
- Boss 命令的状态、叠加和结算顺序：《专项设计-统一效果系统.md》。
- 房间状态、私有/公开投影和动作协议：《专项设计-MatchStateV2与前后端协议.md》。
- 个人退出、失败、通关和购买权：《专项设计-局外结算与购买权.md》。
- Boss 碎片奖励和武器归属：《专项设计-武器系统.md》。

本专项后续按“一个 Boss 一次独立评审”的方式持续迭代。每次新增 Boss 只允许增加配置、版本化插件绑定和必要的白名单效果命令，不允许修改已经稳定的击杀、清波、结算与路径所有权规则。
