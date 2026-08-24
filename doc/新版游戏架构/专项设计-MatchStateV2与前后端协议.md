# 专项设计：MatchState V2 与前后端协议

> 状态：V0.1，项目改造目标协议  
> 原则：新旧领域模型不混用；客户端提交意图，服务端决定结果

## 1. 生命周期

```ts
type MatchPhase =
  | 'lobby'
  | 'loadout_locked'
  | 'loading'
  | 'countdown'
  | 'running'
  | 'settling'
  | 'finished';
```

- `loadout_locked` 后锁定神将进度、武器和被动道具快照。
- 只有 `running` 接受战斗动作。
- `settling` 后不再生成波次或接受玩家操作。

## 2. 配置清单

```ts
interface MatchManifest {
  schemaVersion: 2;
  matchId: string;
  matchSeed: string;
  tickDurationMs: number;
  configVersion: string;
  configHashes: {
    soldiers: string;
    enemies: string;
    waves: string;
    economy: string;
    generals: string;
    effects: string;
    items: string;
    weapons: string;
    settlementRewards: string;
  };
  orderedPlayerIds: string[];
}
```

房间创建后配置快照不可热更新。线上配置发生变化只影响新房间。

## 3. 权威状态

```ts
interface MatchStateV2 {
  schemaVersion: 2;
  manifest: MatchManifest;
  phase: MatchPhase;
  tick: number;
  eventSequence: number;
  roomRevision: number;
  battlefield: BattlefieldState;
  wave: WaveRuntimeState;
  enemies: Record<string, MinionEnemyState>;
  laneWaveProgress: Record<string, PlayerLaneWaveProgress>;
  players: Record<string, PlayerMatchState>;
  result?: MatchResult;
}
```

### 3.1 共享战场

```ts
interface BattlefieldState {
  boardId: string;
  width: number;
  height: number;
  cells: BoardCell[];
  hub: BoardPosition;
  laneRoutes: Record<PlayerSlotId, RouteSnapshot>;
  playerLaneAssignments: Record<string, PlayerSlotId>;
}

type BoardCellKind = 'path' | 'deployable' | 'blocked';
type PlayerSlotId = 'P1' | 'P2' | 'P3' | 'P4';
```

不存在 `locked`、`unlockCost` 或扩地状态。占用情况由玩家单位位置推导，不把 `occupied` 固化为地形种类。

每位玩家绑定一个出生路线槽。路线先经过玩家自己的防守区域，再进入公共循环圈；小怪进入循环圈后仍保留原 `homeLanePlayerId`，但可以被任意玩家攻击。

### 3.2 路线波次状态

```ts
interface PlayerLaneWaveProgress {
  playerId: string;
  laneSlot: PlayerSlotId;
  waveNumber: number;
  plannedSpawnCount: number;
  completedSpawnCount: number;
  aliveEnemyCount: number;
  spawningCompleted: boolean;
  clearRewardRice: number;        // 5 × waveNumber
  clearRewardGranted: boolean;
  clearRewardSettlementId?: string;
}
```

`aliveEnemyCount` 只统计以该玩家路线出生的本波小怪，与小怪当前位于哪个棋盘区域无关。公开投影可只发送计数；服务端内部通过敌人 ID 集合或按状态重算进行校验。

### 3.3 玩家状态

```ts
interface PlayerMatchState {
  playerId: string;
  joinIndex: number;
  connection: 'online' | 'offline';

  rice: number;                    // 初始 10
  recruitSequence: number;         // 初始 0
  nextRecruitCost: number;         // 初始 5
  populationUsed: number;
  populationCap: number;           // 第一版默认 10

  tray: [TraySlot, TraySlot, TraySlot, TraySlot, TraySlot];
  trayRevision: number;
  garrisonPoolRuntime: GarrisonPoolRuntime;

  boardPieces: Record<string, BoardPieceState>;
  boardRevision: number;
  generalFormations: Record<string, GeneralFormationState>;
  generalProgress: Record<string, GeneralProgressSnapshot>;
  highestCompletedWave: number;

  weaponLoadoutSnapshot: Record<string, WeaponSlotSnapshot[]>;
  activeItemState: ActiveItemRuntime[];
  passiveItemSnapshot: PassiveItemSnapshot[];
}
```

`generalProgress` 是局内只读成长快照加本局新增经验的投影。永久存档只在结算事务成功后写入，不能每个怪物死亡直接写数据库。

## 4. 征兵事务

```ts
nextCost(recruitSequence) = 5 + 2 × recruitSequence
```

收到 `RECRUIT_BATCH` 时服务端：

1. 校验阶段、动作幂等键和 `expectedTrayRevision`。
2. 读取当前 `nextRecruitCost`。
3. 校验斋饭余额。
4. 使用权威随机流抽取恰好 5 个结果：每槽字符分支固定为 10%，剩余字符 Token 等权。
5. 若为第一批且五格全部为字符，放回最后一个字符 Token，并把该格重抽为天兵。
6. 一次性扣费、覆盖托盘、增加 `recruitSequence`。
7. 重算下一价格并增加托盘修订号。
8. 返回结果事件；客户端播放约 0.5 秒动画。

失败时上述状态全部不变。

## 5. 客户端动作

```ts
type MatchActionV2 =
  | RecruitBatchAction
  | SwapTrayBoardAction
  | MoveBoardPieceAction
  | MergeSoldiersAction
  | SetGeneralFixedAction
  | MoveFixedGeneralAction
  | UseActiveItemAction;
```

### 5.1 基础动作

```ts
interface ActionBase {
  schemaVersion: 2;
  actionId: string;
  matchId: string;
  playerId: string;
  clientKnownTick: number;
}

interface RecruitBatchAction extends ActionBase {
  type: 'RECRUIT_BATCH';
  expectedTrayRevision: number;
}

interface SwapTrayBoardAction extends ActionBase {
  type: 'SWAP_TRAY_BOARD';
  trayIndex: 0 | 1 | 2 | 3 | 4;
  boardCellId: string;
  expectedTrayRevision: number;
  expectedBoardRevision: number;
}

interface MoveBoardPieceAction extends ActionBase {
  type: 'MOVE_BOARD_PIECE';
  entityId: string;
  targetBoardCellId: string;
  expectedBoardRevision: number;
}
```

固定神将移动必须使用 `formationId`，不能让客户端逐字提交一组坐标后要求服务端照单执行。服务端根据当前朝向、形状和目标锚点计算所有格子并原子校验。

### 5.2 禁止客户端提交

- 征兵抽取结果。
- 合成后的等级或实体 ID。
- 选中的怪物目标。
- 暴击结果、伤害数值、小怪死亡。
- 斋饭和经验奖励。
- 波次结果、Boss 效果或胜负。

## 6. 动作响应

```ts
interface ActionReceipt {
  actionId: string;
  accepted: boolean;
  acceptedAtTick?: number;
  roomRevision: number;
  boardRevision?: number;
  trayRevision?: number;
  rejectCode?: ActionRejectCode;
}
```

基础拒绝码：

- `MATCH_NOT_RUNNING`
- `NOT_MATCH_MEMBER`
- `NOT_OWNER`
- `STALE_REVISION`
- `INSUFFICIENT_RICE`
- `POPULATION_LIMIT`
- `INVALID_CELL`
- `CELL_OCCUPIED`
- `INVALID_SWAP`
- `INVALID_FORMATION`
- `INVALID_MERGE`
- `ITEM_NOT_READY`
- `DUPLICATE_ACTION`

重复 `actionId` 必须返回第一次处理的收据，而不是再次执行。

## 7. 可见性与推送

### 7.1 房间公开

- Tick、阶段、波次和结果。
- 棋盘地形、怪物位置/生命/四属性。
- 所有玩家已部署的棋子、神将组合和人口使用量。
- 已经发生的攻击、伤害、死亡和技能表现事件。
- 各玩家本路线当前波的已出生数、存活数与清波保底领取状态。

### 7.2 仅本人可见

- 召唤托盘内容。
- 大本营剩余字符供应与随机流状态。
- 斋饭和下一征兵价格。
- 未使用主动道具的完整信息。

### 7.3 服务端隐藏

- PRNG 内部状态。
- 将来波次的未公开内容。
- 反作弊标记和幂等账本。

服务端分别产生：

- `PUBLIC_STATE_PATCH`：发给房间所有人。
- `PRIVATE_PLAYER_PATCH`：只发对应玩家。
- `COMBAT_EVENT_BATCH`：按事件序列广播。
- `CHECKPOINT`：周期性完整权威快照。

## 8. 断线重连

客户端重连提交 `lastKnownRoomRevision` 和 `lastKnownEventSequence`：

- 缺口仍在缓存中：补发事件和状态 Patch。
- 缺口过大或校验失败：下发公开快照加本人私有快照。
- 快照恢复后，客户端丢弃本地未确认预测，重新播放必要的纯表现。
- 托盘内容不得出现在其他玩家的重连快照中。

## 9. 回放

一场比赛至少记录：

- `MatchManifest`。
- 被接受的玩家动作及其服务端排序。
- 确定性随机事件序号。
- 周期检查点和最终结果。

回放程序使用同版本配置和动作重新模拟，并比较检查点哈希。动画帧、客户端输入过程和被拒动作无需驱动模拟，但拒绝收据可保留用于审计。

### 9.1 击杀与本路清波事件

- 每个敌人保存 `homeLanePlayerId`、`waveNumber` 和 `lastDamagedByPlayerId`。
- 死亡时，最后有效伤害玩家获得 1 斋饭和该怪的神将经验结算权。
- 当某路线该波已经完成出怪且存活数为 0 时，服务端立即给路线主人发放 `5 × waveNumber` 斋饭。
- 清波奖励按 `matchId + playerId + waveNumber` 幂等，各玩家结算时间相互独立。
- 完整退出、失败和通关结算见《专项设计-局外结算与购买权.md》。

## 10. 旧项目迁移

### 10.1 可复用

- 房间成员和最多 4 人连接。
- 棋盘坐标与怪物路线。
- 服务端 Tick 和按房间串行的动作队列。
- Socket 网关、状态投影、回放记录器、持久化适配层。

### 10.2 必须替换

- `TowerState` 及建造/升级/出售协议。
- 旧金币、商店、装备和扩地字段。
- 客户端上报伤害、击杀或随机结果的入口。
- 任何同时读写 V1 与 V2 战斗状态的兼容代码。

迁移采用“新房间只创建 V2、旧房间自然结束”的版本闸门，不在同一场比赛中转换状态。

## 11. 验收测试

- 客户端伪造征兵结果、暴击、伤害和奖励均被协议层拒绝。
- 第 1、2、3 次成功征兵分别扣 5、7、9；失败不推进序号。
- 两个客户端同时拖动同一实体时只有修订号匹配的请求成功。
- 4 人可看到同一怪物和公开棋盘，但看不到别人的托盘。
- 断线后通过 Patch 或完整快照恢复相同哈希。
- 回放在相同 Manifest 下得到相同目标、暴击、死亡和奖励。
- 4 名玩家的本路清波奖励可在不同 Tick 发放，每人每波最多一次。
- V2 状态和动作类型中不存在扩地、未解锁格或旧塔字段。
