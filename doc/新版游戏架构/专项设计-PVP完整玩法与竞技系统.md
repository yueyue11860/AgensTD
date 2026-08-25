# 专项设计：PVP 完整玩法与竞技系统

> 状态：V1.0 开发权威稿  
> 适用范围：真人实时 PVP；PVE 继续使用现有 20 波合作规则  
> 核心目标：3～6 分钟一局、双方规则完全对称、服务器权威、局外付费强度不进入排位  
> 首发模式：1v1 排位、1v1 休闲、自定义 1v1；2v2 为第二阶段  
> 明确废弃：Agent Player 参赛、真人/Agent 双榜、以 PVE 波次和分数充当 PVP 排名

## 1. 产品定位与边界

PVP 是与 PVE 平行的独立游戏模式，不是把 PVE 房间改名，也不是让两名玩家共守同一张 PVE 图。双方在同一场实时对局中使用完全相同的规则、内容版本和随机约束，各自守护一条镜像路线，并通过 PVP 专属资源“真经”向对手制造可解释的怪物压力。

PVP 复用以下成熟能力：

- 天兵 1～5 级、字符、神将组合、固定/解除、羁绊和自动战斗；
- 结构化效果、控制抗性、召唤物、武器效果预算；
- 5 格召唤托盘、备战席、总人口、服务端权威动作和修订号；
- 确定性随机、快照、增量同步、断线重连和回放哈希；
- 旧前端首页左右分屏、房间大厅、排行榜和回放页面的视觉外壳。

PVP 不复用以下 PVE 规则：

- 4 人公共循环圈和跨玩家补刀；
- 固定 20 波、每 5 波 Boss 和全员共同失败；
- PVE 购买权、武器碎片掉落和局外成长强度；
- 棋盘全员自由落子；
- PVE 清波低保、队友经验分配和退出奖励档位。

## 2. 模式矩阵与开放顺序

| 模式 | 人数 | 是否计段位 | 构筑规则 | 地图 | 首发 |
|---|---:|---|---|---|---|
| 排位斗法 | 1v1 | 是 | 竞技标准化 | 两界斗法台 | 是 |
| 休闲斗法 | 1v1 | 否 | 竞技标准化 | 两界斗法台 | 是 |
| 自定义房 | 1v1 | 否 | 房主选择标准预设 | 两界斗法台 | 是 |
| 双人结阵 | 2v2 | 独立段位 | 队伍标准化 | 四象斗法台 | 第二阶段 |
| 赛事房 | 1v1/2v2 | 赛事积分 | 锁版本、裁判控制 | 指定地图 | 第三阶段 |

首版不做电脑对手、异步镜像、Agent 对手或用录像伪装真人。若以后增加机器人，必须在匹配前和记录中明确标记，且不得进入真人排位榜。

## 3. PVP 开启方式与入口流程

### 3.1 前端入口

旧首页左右分屏改造为：

- 左侧“西游守关”：进入 PVE 关卡与合作房间；
- 右侧“斗法竞技”：进入 PVP 中心；
- 删除 Agent Interface、Agent Skill Guide、硅基/碳基文案和 Agent 接入按钮；
- 原排行榜和热门回放视觉外壳改为 PVP 赛季榜与对局记录。

PVP 路由使用独立命名空间：

```text
/pvp                         PVP 中心
/pvp/matchmaking             匹配队列与确认
/pvp/rooms                   自定义房大厅
/pvp/rooms/:roomId           自定义房准备页
/pvp/game/:matchId           PVP 战场
/pvp/results/:matchId        权威结算页
/pvp/history                 本人对局记录
/pvp/history/:matchId        对局详情与回放
/pvp/leaderboard             赛季排行榜
/profile                     玩家 PVE/PVP 综合档案
```

PVE 继续保留 `/room`、`/room/:roomId` 和 `/gaming`，不得让 PVP 状态字段混入现有 `GameState.pve`。

### 3.2 开放条件

排位开启条件：

1. 真人账户完成登录；
2. 完成一次 3 分钟以内的 PVP 教学演练；
3. 客户端协议版本、战斗目录版本和 PVP 规则版本与服务器一致；
4. 当前没有未结束的排位对局或处罚中的逃跑状态；
5. 已保存合法的 PVP 竞技构筑。

休闲和自定义房不要求段位，但仍要求合法构筑与兼容版本。教学演练是明确标注的本地/服务器脚本关，不计战绩，不伪装真人匹配。

### 3.3 匹配流程

```text
进入 PVP 中心
  → 选择排位/休闲
  → 校验竞技构筑和版本
  → 创建队列票据
  → 按地区、延迟、模式、规则版本、隐藏分搜索
  → 双方收到 10 秒 MATCH_FOUND
  → 双方确认并预加载地图
  → 服务端冻结双方构筑、随机袋和地图版本
  → 5 秒开局准备
  → 对局点火
```

任一玩家未在 10 秒内确认：

- 对局不创建，不改变段位；
- 未确认者第一次提示，连续发生时进入 1/5/15 分钟递增队列冷却；
- 已确认者立即回到优先队列，不承担处罚。

### 3.4 匹配搜索规则

- 默认按内部 MMR ±100 搜索；
- 每等待 10 秒向两侧扩大 50，最大 ±400；
- 延迟优先同区域，目标 RTT 小于 120ms；
- 定级玩家按高不确定度匹配，但禁止直接撞入顶级榜前 200；
- 最近 3 场遇到同一对手时降低匹配优先级，人数不足时可放开；
- 组队、规则版本和平台输入方式预留维度，但首版不制造无意义的小池子。

## 4. 首发完整地图：两界斗法台

### 4.1 几何与视野

- 地图 ID：`pvp_dual_realm_v1`；
- 逻辑尺寸：29×29；
- 上半场 `y=0..13` 属于 A 方，下半场 `y=15..28` 属于 B 方；
- `y=14` 是不可部署的中立分界带；
- 双方都能看到对手已部署的单位、神将和场上怪物；
- 对手召唤托盘、备战席具体内容、当前真经操作队列保持隐藏；
- 已公开生效的羁绊、武器、主动道具效果必须可查看，不能形成不可解释伤害。

### 4.2 出生区、核心与路线

A 方出生门为 `x=13..15,y=0..2`，核心为 `x=13..15,y=11..13`。基础路线锚点：

```text
(14,1) → (14,3) → (4,3) → (4,11) → (24,11)
       → (24,5) → (9,5) → (9,9) → (19,9)
       → (19,7) → (14,7) → (14,12)
```

B 方是严格镜像，坐标变换为 `(x,y) => (x,28-y)`：

```text
(14,27) → (14,25) → (4,25) → (4,17) → (24,17)
        → (24,23) → (9,23) → (9,19) → (19,19)
        → (19,21) → (14,21) → (14,16)
```

实现时由地图编译器把轴对齐锚点展开为离散路径格。出生门、核心、路径和中线都不可部署，其余本方半场格默认可部署。地图没有扩地系统。

### 4.3 领地与攻击资格

- A 方只能把自己的棋子放在 A 方部署区，B 方同理；
- 托盘和备战席仍为玩家私有；
- 玩家单位只选择自己路线上的基础怪、Boss 和对手发送的压力怪；
- 范围、全屏、召唤和效果区域均按来源玩家的半场裁剪；
- 任何技能不得直接伤害、控制、移动或删除对手棋子；
- PVP 的对抗只通过公开的压力怪和胜负资源发生。

这条领地限制只属于 PVP。PVE 继续允许玩家在共享棋盘任意合法格协作布阵。

### 4.4 出生保护与正常间距

- 怪物整个碰撞圆完全离开本方 3×3 出生门后才可被选中；
- 禁止使用固定无敌时间代替几何判定；
- 正常刷怪必须等待上一只怪物身体完整离开出生门后再生成下一只；
- 场上怪物允许因聚怪、拉拽或减速发生重叠，不设置全局碰撞排斥。

### 4.5 地图版本

每局快照记录 `mapId`、`mapVersion`、`routeHash`、`rulesetVersion`。排位赛季中途只允许修复确定性 Bug；任何路径或部署区变化必须提升地图版本，新旧客户端不得同局。

## 5. 一局 PVP 的完整循环

### 5.1 开局资源

- 核心耐久：10；
- 初始斋饭：10；
- 总人口：10；
- 召唤托盘：5 格；
- 备战席：基础 2 格；
- 第一批召唤仍保证至少一名天兵；
- 召唤价格：`min(5 + 2 × 已付费召唤次数, 25)`；
- 开局点火后有 5 秒准备时间，再生成第 1 阵怪。

### 5.2 无限阵次

PVP 不设 20 波通关。每阵双方获得同规格的 10 只基础怪：

- 阵次间隔基线 20 秒，不等待上一阵全部死亡；
- 单只生成仍遵守“上一只完全离开出生门”的间距规则；
- 每阵开始双方固定获得 5 斋饭；
- 每只基础怪被击杀，最后击杀者所属玩家获得 1 斋饭、1 真经；
- 神将经验沿用贡献结算，但只统计本方半场战斗；
- 压力怪死亡给予防守方 2 斋饭，不产生真经和神将经验，防止压力无限复制。

基础成长建议公式：

```text
HP(n)       = round(baseHp × 1.16^(n-1))
Armor(n)    = baseArmor + 2 × (n-1)
MagicRes(n) = baseMagicRes + 2 × (n-1)
MoveSpeed   = 前 10 阵固定；天劫阶段再按收束规则提升
```

第 5、15、25…阵将其中一只替换为精英；第 10、20、30…阵将最后一只替换为 PVP Boss。首版 Boss 可以只有更高四属性和更高核心伤害，复杂技能随 Boss 专项逐个开放。

### 5.3 真经压力系统

真经是仅在本局存在的 PVP 对抗资源，与斋饭、金币、经验完全分离。

首版只开放一个容易验证的命令：

```text
遣妖：消耗 5 真经
效果：向对手安全生成队列加入 1 只当前阵次 150% HP 的“妖”压力怪
限制：每秒最多一次；待生成队列最多 6 只；不能插入出生门内已有怪物的身体
```

压力怪：

- 到达核心造成 1 点伤害；
- 被击杀给防守方 2 斋饭；
- 不给发送方额外经济；
- 不产生新的真经或神将经验；
- 记录发送者、来源命令、生成 Tick 和结算结果。

第二阶段可增加“群潮”和“魔化”，但必须继续满足：资源成本公开、压力有上限、防守成功有追赶收益、不能直接操作对手阵容。

### 5.4 核心、泄漏与胜负

- 普通怪和压力怪抵达核心造成 1 点伤害；
- 精英造成 2 点；
- Boss 造成 4 点；
- 核心耐久降到 0 的一方失败；
- 主动投降、永久退出或断线超时直接判负；
- 同一权威 Tick 双方核心同时归零判平局；
- 服务端故障、版本失配或无法恢复的房间异常判无效局，不改变段位。

### 5.5 天劫收束

目标时长 3～6 分钟，防止极端控制阵容无限拖延：

- 6:00 起进入天劫，每 20 秒怪物最终生命 +20%、移动速度 +5%；
- 8:00 起所有到达核心的伤害额外 +1；
- 10:00 起进入一漏即败：任意怪物抵达即把核心耐久置零；
- 12:00 硬超时仍无人泄漏，按“核心耐久比例 → 本方场上剩余怪物总生命值（越低越优）→ 对敌方核心累计伤害”依次裁决；全部相同判平局。击杀、伤害榜等展示统计不额外加权，避免刷数据改变最优战术。

## 6. 随机公平与竞技构筑

### 6.1 配对随机袋

排位不能让一方因纯随机连续抽不到天兵或字符：

- 双方每 5 次召唤使用相同类别多重集合，但顺序分别确定性洗牌；
- 类别集合保证总体字符率与天兵类型分布一致；
- 字符仍从各自剩余神将字符池等权抽取；
- 双方 PRNG 使用 `matchSeed + side + bagIndex`，服务端记录袋哈希，不向客户端提前公开；
- 第一批至少一名天兵的规则继续有效；
- 休闲和自定义房默认也使用配对袋，房主不能关闭排位公平规则后仍标记为标准房。

### 6.2 局外养成隔离

排位使用“竞技借用库”：

- 所有当季允许的神将、PVP 武器和 PVP 道具对双方等权开放；
- 神将等级、武器品质和道具效果使用赛季规则表，不读取 PVE 永久成长数值；
- 玩家局外拥有的武器和道具只影响 PVE 收藏与构筑，不给排位数值优势；
- 专武仍只能配套对应神将；
- PVP 构筑单独保存，固定为每神将 2 武器、2 主动、6 被动的结构，但规则表可禁用不适合 PVP 的条目。

首发 PVP 道具不得向对手棋子施加负面效果。天雷令、定风符等只能作用于自己半场的怪物，并使用 PVP 独立系数。

### 6.3 内容禁用与热修

赛季规则包含：

- `allowedGeneralIds`、`allowedWeaponIds`、`allowedItemIds`；
- 每个结构化效果的 PVP 参数覆盖；
- 全局攻速、冷却、召唤数量、投射物、控制链和位移预算；
- 已知异常内容的禁用开关。

禁用只影响尚未点火的新对局；已开始的对局继续使用冻结快照。结算记录必须保存内容版本，禁止用最新目录回算旧局。

## 7. 房间、准备、重连与观战

### 7.1 房间状态机

```text
created
  → waiting_players
  → ready_check
  → loading
  → countdown
  → playing
  → settling
  → completed | voided
```

排位房由匹配服务创建，玩家不能修改规则或踢人。自定义房允许房主设置密码、观战、地图皮肤、是否允许投降以及标准预设，但不允许伪装成排位。

自定义房首版采用“双准备自动开局”：两名玩家都进入并准备后，服务端立即冻结构筑并进入 5 秒倒计时，不再增加一个容易产生争议的房主开局按钮。任一方取消准备则不会点火。房间密码必须保存为随机盐 `scrypt`/等价强哈希并使用恒定时间比较，禁止只保存 `hasPassword` 或裸 SHA-256；公开列表只返回是否有密码。空房 10 分钟、已结束且无人连接 2 分钟后自动回收，`roomId` 不得复用为 `matchId`。

### 7.2 断线规则

- 断线后权威战斗继续，已有单位继续自动攻击；
- 20 秒内允许无损重连并恢复完整快照；
- 20～60 秒显示掉线状态，玩家仍可重连，但无法补发旧动作；
- 连续断线 60 秒判负；
- 客户端主动退出立即二次确认，确认后判投降；
- 服务器确认的区域性事故将受影响对局标记为 `voided`，不得由客户端自行申报无效。

### 7.3 观战

首版自定义房可选择关闭或允许最多 8 名观众。排位实时观战默认关闭，好友观战至少延迟 30 秒。观众只有只读投影，不能进入玩家 Socket 房间、读取隐藏托盘或发送游戏动作。

## 8. 对局记录与确定性回放

### 8.1 对局摘要

每局永久保存：

- `matchId`、赛季、模式、地图及规则版本；
- 开始/结束时间、持续时长、结果、胜负原因；
- 双方玩家 ID、名称、段位、MMR/LP 前后值；
- 构筑快照哈希、内容目录版本和随机袋哈希；
- 核心剩余、基础怪/压力怪击杀、泄漏、发送真经、经济与征兵统计；
- 激活神将、羁绊、武器、道具及关键时间点；
- 结算事务 ID、回放状态、举报保全状态。

### 8.2 玩家统计

```ts
interface PvpParticipantStats {
  playerId: string
  side: 'A' | 'B'
  result: 'win' | 'loss' | 'draw' | 'void'
  coreHpRemaining: number
  baseKills: number
  pressureKills: number
  leaks: number
  scriptureEarned: number
  scriptureSpent: number
  pressureSent: number
  pressureLeaked: number
  rationsEarned: number
  rationsSpent: number
  paidRecruitCount: number
  activeGeneralIds: string[]
  peakPopulation: number
  highestSoldierLevel: number
  damageDealt: number
  controlDurationMs: number
}
```

这些数据用于展示和分析，不影响本局胜负和基础段位算法，避免玩家为了评分数据做出伤害队友或拖延对局的行为。

### 8.3 回放

- 记录双方权威动作、规则快照、随机种子承诺、关键事件和周期检查点；
- 回放从同版本规则重新推演，并在检查点比较状态哈希；
- 普通完整回放保留 30 天；榜前 200、赛事、被举报或官方精选保留 180 天以上；
- 对局摘要和结算永久保存；
- 客户端提交的录像只能作为本地展示，不得作为段位和结算依据。

## 9. 结算系统

### 9.1 权威事务

唯一允许结算的来源是 PVP 房间从 `playing` 进入 `settling` 时产生的权威 `PVP_MATCH_FINISHED` 事件。结算必须在一个数据库事务内：

1. 锁定对局和双方当前赛季段位行；
2. 校验对局尚未结算、双方结果互补、规则快照完整；
3. 写入对局摘要和双方统计；
4. 更新内部 MMR、可见 LP、胜负场、连胜和赛季任务；
5. 写入奖励流水；
6. 更新排行榜投影；
7. 标记结算完成并返回同一份不可变收据。

唯一约束：

- `pvp_matches.match_id` 唯一；
- `pvp_match_players(match_id, player_id)` 唯一；
- `pvp_rating_changes(match_id, player_id)` 唯一；
- `pvp_reward_ledger(match_id, player_id, reward_type)` 唯一；
- 相同 `requestId` 同载荷重放返回原收据，不得重复加分或发奖励；
- 相同 `requestId` 不同载荷返回 409 冲突。

### 9.2 结算原因

```text
core_destroyed       核心归零
surrendered          主动投降
disconnect_forfeit   断线超时
simultaneous_draw    同 Tick 双败
hard_timeout         12 分钟裁决
server_void          服务端无效局
ruleset_invalid      规则快照异常，无效局
```

### 9.3 奖励

PVP 奖励以荣誉、赛季外观和受控金币为主，不掉落 PVE 武器碎片或购买权：

- 排位胜利：20 荣誉、10 金币；
- 排位失败：8 荣誉、5 金币；
- 平局：12 荣誉、6 金币；
- 休闲：荣誉和金币减半；
- 自定义房：无可交易奖励；
- 每日前 10 场可获得金币，之后只保留段位与少量荣誉；
- 投降或断线仍按失败结算段位，但恶意短局不发金币和荣誉；
- 无效局不改变段位、不消耗任务次数、不发胜负奖励。

具体奖励数值放在赛季配置，流水必须可审计和幂等。

## 10. 段位系统

### 10.1 内部 MMR

首版冻结为可复现的 Elo 策略 `rank-v1.0.0`：

```text
初始 rating = 1500
expected     = 1 / (1 + 10^((opponentRating - selfRating) / 400))
score        = 胜 1 / 平 0.5 / 负 0
delta        = round(K × (score - expected))
K            = 前 5 场 64；正常 32；rating >= 2000 后 24
```

- 只由胜、负、平和对手强度更新；
- 伤害、时长、击杀、投降时间和付费不改变 MMR 权重；
- 双方必须使用同一事务开始时冻结的 `ratingBefore` 计算，不能先更新胜者再计算败者；
- 算法版本随赛季冻结，客户端只展示收据，禁止自行计算；
- Glicko-2 可作为后续新赛季算法，但必须新建 policy 版本和字段迁移，不能在赛季中途静默替换。

### 10.2 可见段位与 LP

| 大段位 | 小段位 | LP 范围 |
|---|---|---:|
| 玄铁 | III / II / I | 0～299 |
| 青铜 | III / II / I | 300～599 |
| 白银 | III / II / I | 600～899 |
| 黄金 | III / II / I | 900～1199 |
| 紫金 | III / II / I | 1200～1499 |
| 大圣 | 无小段 | 1500+ |
| 斗战胜佛 | 赛季前 500 且满足门槛 | 动态 |

每小段 100 LP。新赛季前 5 场为定级赛，显示“未定级”和进度，但照常记录 MMR。

V1 的可执行 LP 公式为：初始 LP 为 0，前 5 场保持“未定级”展示；`strengthAdjustment = clamp(round((对手MMR-本人MMR)/50), -8, 8)`。胜利为 `25 + strengthAdjustment`，失败为 `min(-5, -20 + strengthAdjustment)`，平局为 `clamp(strengthAdjustment, -5, 5)`；定级赛变化乘 2，最终 LP 最低为 0。斗战胜佛不是静态 LP 段，只有 `LP >= 1800` 且当季天梯前 500 的玩家获得该动态身份。

保护规则：

- 首次进入新大段后 3 场降级保护；
- 大圣及以上无保护；
- 大圣连续 14 天不进行排位后开始每 7 天衰减 25 LP，最低降到紫金 I；
- 逃跑判负外加队列冷却，不额外暗扣无法解释的隐藏分；
- 服务端无效局完全回滚段位变化。

### 10.3 赛季

- 标准赛季 8 周；
- 赛季规则、地图版本、内容白名单和段位算法版本一经开始即冻结；
- 新赛季软重置：`1500 + (旧 MMR - 1500) × 0.5`；
- 可见 LP 根据软重置后的 MMR 和上赛季最高段位校准；
- 赛季奖励取“本赛季最高段位”和最低有效场次，不鼓励到高段后永久停排；
- 赛季结束先冻结榜单、完成未决结算，再发奖励和开启下一赛季。

## 11. 排行榜

### 11.1 榜单类型

- 赛季天梯总榜：核心榜，按 LP、MMR、胜场、达到该分时间排序；
- 好友榜：同一数据的关系过滤；
- 地区榜：玩家主动选择地区且满足隐私规则后参与；
- 名人堂：保存每赛季前 100 的最终快照；
- 官方精选对局：人工或规则标记，不按客户端点赞直接决定。

首版不再展示 human/agent/all 三榜，不再按最高波次或最高分排序。

### 11.2 排序与并列

```text
1. visibleLp DESC
2. internalRating DESC
3. seasonWins DESC
4. reachedAt ASC
5. playerId ASC（稳定排序）
```

榜单只统计完成定级且未封禁账户。接口必须同时返回当前玩家自身排名和榜首分页，避免玩家只能在前 100 中寻找自己。

### 11.3 刷新

- 对局结算事务写入权威段位；
- 排行榜投影可异步更新，但目标延迟小于 5 秒；
- 前端使用 Supabase Realtime 或 15 秒轮询刷新；
- 投影失败不回滚已完成结算，后台可从段位表重建；
- 赛季结束榜使用冻结快照，不读取继续变化的实时表。

## 12. 数据模型

### 12.1 核心表

```text
pvp_seasons
  season_id, mode_id, region, status, starts_at, locks_at, ends_at,
  ruleset_version, map_pool_json, content_allowlist_json,
  rating_algorithm_version, reward_policy_version

pvp_modes
  mode_id, version, team_size, ranked, ruleset_version,
  map_pool_version, enabled

pvp_maps
  map_id, map_version, config_json, route_hash, checksum, status

pvp_ratings
  season_id, mode_id, player_id, rating, visible_lp,
  visible_lp, tier, division, wins, losses, draws, streak,
  placement_games, peak_lp, reached_at, version

pvp_matchmaking_tickets
  ticket_id, player_id, mode, region, ruleset_version,
  rating_snapshot, state, created_at, expires_at

pvp_matches
  match_id, season_id, mode, map_id, map_version, ruleset_version,
  catalog_version, effect_version, status, result_reason, winner_player_id,
  seed_commitment, integrity_status, settlement_status,
  started_at, ended_at, duration_ms, settlement_version

pvp_match_players
  match_id, player_id, side, result, rating_before, rating_after,
  lp_before, lp_after, loadout_snapshot_json, stats_json,
  disconnected_ms, forfeited

pvp_settlements
  settlement_id, match_id, player_id, request_id, fingerprint,
  outcome, rating_before, rating_delta, rating_after,
  rank_before, rank_after, reward_json, status, committed_at

pvp_rating_ledger
  event_id, season_id, mode_id, player_id, match_id,
  before_json, delta_json, after_json, policy_version, created_at

pvp_settlement_outbox
  event_id, match_id, player_id, event_type, payload_json,
  status, attempts, next_retry_at

pvp_replay_manifests
  match_id, replay_version, seed, initial_snapshot_ref,
  ruleset_versions_json, action_count, final_state_hash,
  visibility, status, retention_until, preserved_reason

pvp_replay_chunks
  match_id, chunk_index, first_tick, last_tick,
  payload_or_object_uri, sha256

pvp_leaderboard_snapshots
  season_id, snapshot_type, generated_at, entries_json
```

`pvp_rating_ledger` 只追加，纠错通过补偿事件完成，不改写历史。每个 `matchId + playerId` 只能产生一张结算单和一个段位流水。回放按分块保存，不把 3～12 分钟整局 JSONB 塞进单行，也不沿用旧录像的 300 帧截断。

段位原子提交与账户奖励采用“两层一致性”：胜负、双方 Rating 和结算单必须在同一事务中完成；金币、荣誉等账户入账由 outbox 使用唯一 `eventId` 重试。前端需要区分 `rating_committed`、`reward_pending`、`reward_committed`，账户服务暂时不可用不能吞掉正式赛果。

### 12.2 账户扩展

现有 `player_accounts` 继续保存金币、道具和武器。PVP 段位使用独立表，避免每场排位把整个账户 JSON 当作排行榜数据重写。账户只增加：

- PVP 竞技构筑引用；
- 教学完成标记；
- 地区和隐私偏好；
- 当前逃跑处罚截止时间；
- 最近已完成结算 ID 的只读摘要缓存。

## 13. 网络协议

### 13.1 REST

```text
GET  /api/pvp/profile
GET  /api/pvp/seasons/current
GET  /api/pvp/ruleset
PUT  /api/pvp/loadout
POST /api/pvp/queue
DELETE /api/pvp/queue/:ticketId
POST /api/pvp/proposals/:proposalId/accept
GET  /api/pvp/rooms
POST /api/pvp/rooms
GET  /api/pvp/matches?cursor=&mode=&result=
GET  /api/pvp/matches/:matchId
GET  /api/pvp/matches/:matchId/replay
GET  /api/pvp/leaderboard?seasonId=&scope=&cursor=
POST /api/pvp/matches/:matchId/report
```

双方确认前只有短生命周期的 `proposalId`，不提前创建正式 `matchId`。双方均确认且构筑冻结成功后，服务端才生成永不复用的 `matchId`；因此确认接口和 `PVP_MATCH_ACCEPT` 不能接受客户端伪造的 matchId。

所有写接口要求本人身份、`requestId`、预期版本和幂等收据。排行榜、公开记录和回放根据隐私策略提供脱敏读接口。

### 13.2 Socket 事件

客户端上行：

```text
PVP_QUEUE_JOIN
PVP_QUEUE_CANCEL
PVP_MATCH_ACCEPT
PVP_JOIN_MATCH
PVP_SEND_ACTION
PVP_SEND_PRESSURE
PVP_SURRENDER
PVP_REQUEST_FULL_STATE
```

服务端下行：

```text
PVP_QUEUE_STATE
PVP_MATCH_FOUND
PVP_MATCH_ACCEPTED
PVP_MATCH_VOIDED
PVP_ROOM_SNAPSHOT
PVP_COUNTDOWN
PVP_TICK_UPDATE
PVP_ACTION_RESULT
PVP_PRESSURE_EVENT
PVP_MATCH_FINISHED
PVP_SETTLEMENT_READY
```

PVP Tick 投影必须包含双方公开战场、本人的隐藏托盘/备战席、核心、阵次、真经、天劫状态和内容版本。对手隐藏区不得通过全量状态泄露。

## 14. 服务端模块边界

```text
pvp-v1/map                 地图、部署区、镜像路线、出生保护
pvp-v1/runtime             双方战斗状态、阵次、核心、天劫
pvp-v1/pressure            真经账本、压力命令和安全生成队列
pvp-v1/loadout             竞技借用库、白名单和构筑快照
pvp-v1/matchmaking         队列票据、搜索和确认
pvp-v1/room                PVP 独立房间状态机和重连
pvp-v1/settlement          权威结算、幂等事务和奖励
pvp-v1/rating              MMR、LP、段位、赛季重置
pvp-v1/history             对局摘要、分页、详情和隐私
pvp-v1/leaderboard         实时投影与赛季冻结榜
pvp-v1/replay              确定性回放与检查点哈希
```

严禁在 `pve-v2/runtime.ts` 中堆叠 PVP 胜负分支。共享的天兵、神将、效果和战斗解析应抽到模式无关层，PVE/PVP 各自编排。

## 15. 反作弊、滥用与可观测性

- 客户端只提交意图，不能提交伤害、掉落、真经、胜负、LP 或奖励；
- 排位只接受 OAuth/正式真人 principal；任何 Socket/REST payload 都不得覆盖认证得到的 `playerId`、`playerName` 或身份类型；
- 每个动作校验本人、当前状态、Tick 窗口、修订号、冷却、资源和频率；
- 同 requestId 重放幂等，不同载荷冲突；
- 服务端记录异常动作率、修订冲突率、断线率、对局时长和状态哈希；
- 举报会保全回放和网络摘要，但举报本身不自动改判；
- 串通刷分检测关注重复对手、异常投降时间、固定收益循环和设备/网络关联；
- 处罚分为队列冷却、赛季榜剔除、临时封禁和永久封禁；
- 管理操作必须留下操作者、理由、前后值和时间。
- 每个动态 `PvpMatch` 独立创建 recorder、结算上下文和销毁生命周期，禁止只给默认房间挂全局录像器；
- 旧 `POST /api/replays` 的客户端自报胜利入口不得进入 PVP，正式赛果只能消费唯一的权威终局事件；
- Realtime 只发布脱敏榜单视图或服务端投影，不直接公开原始 rating 行、隐藏构筑和玩家隐私字段。

关键监控：

- 匹配等待 P50/P95、确认失败率；
- 3/6/10 分钟对局结束比例；
- 各段位胜率、先手/上下方胜率；
- 神将、羁绊、武器、道具选取率和胜率；
- 真经产生/消费、压力击杀/泄漏；
- 断线重连成功率、无效局率；
- 结算延迟、幂等重放、排行榜投影延迟；
- 回放哈希不一致次数。

## 16. Agent 系统退场计划

用户产品不再允许 Agent 参与竞技：

1. 首页 `AGENT INTERFACE` 改为 PVP；
2. 删除 `/skill` Agent 接入说明和前端所有硅基/碳基文案；
3. PVP 匹配只接受真人账户，拒绝 `playerKind=agent`；
4. 旧 `DualLeaderboard` 替换为赛季 PVP 榜；
5. 旧 `/api/agent`、Agent Token 和 SSE 接口标记废弃，待 PVP 回放/榜单迁移完成后从生产入口移除；
6. 旧数据只读归档，不迁移为 PVP 段位或战绩；
7. 测试机器人只能作为内部压测工具，不拥有玩家身份、不进入正式记录和榜单。

## 17. 分期开发

### 阶段 A：1v1 纵向切片

- 两界斗法台、双方领地和镜像路线；
- 5 秒准备、无限阵次、核心耐久和胜负；
- 双方征兵、布阵、战斗完全隔离；
- 真经“遣妖”一条完整压力链；
- 开局构筑快照、重连、投降和最小结算；
- 首页 PVE/PVP 双入口和 PVP 战场最小 UI。

### 阶段 B：竞技闭环

- 排位/休闲匹配、确认和取消；
- 赛季、Elo V1/LP、段位和排行榜；
- 对局记录、详情、结算页和完整回放；
- Supabase 迁移、事务、幂等和投影重建；
- Agent UI 与生产接口退场。

### 阶段 C：内容与体验

- PVP 武器/道具参数覆盖和赛季白名单；
- Boss、第二/第三压力命令；
- 观战、举报、精选回放和个人档案；
- 数据平衡看板和热修禁用。

### 阶段 D：2v2 与赛事

- 四象斗法台、队伍结算和独立段位；
- 组队匹配、队伍断线和防代打约束；
- 赛事房、裁判、锁版本和赛季名人堂。

## 18. 完成验收

### 地图与战斗

1. A/B 路线严格镜像，路径哈希稳定；双方地图皮肤不能改变逻辑格。
2. 双方只能在自己的部署区落子，范围效果不能越过中线。
3. 怪物身体完全离开出生门后才可被攻击，正常生成不重叠。
4. 同一阵双方基础怪数量、类别集合和数值完全一致。
5. 真经只由基础怪产生；压力怪不能产生真经或经验。
6. 遣妖扣费、排队、生成、击杀奖励和泄漏伤害全链路幂等。
7. 核心归零、投降、断线、同 Tick 双败和硬超时均只有一个权威结果。

### 公平与同步

8. 相同种子可从动作日志重演到相同检查点哈希。
9. 对手快照不泄露托盘、备战席和待发送压力队列。
10. 局外 PVE 武器、道具拥有量不同的两名玩家在排位获得同一竞技借用库。
11. 断线 20 秒内恢复全部状态，不重放已结算动作；60 秒后权威判负。
12. 内容热禁用不改变已点火对局的冻结规则。

### 竞技数据

13. 同一对局重复结算 100 次只产生一份段位变化和奖励。
14. 胜负双方结果、MMR/LP 前后值和奖励流水严格互补且可审计。
15. 无效局不改变段位、奖励、任务或排行榜。
16. 排行榜排序稳定，可查询当前玩家自身排名，并能从段位表全量重建。
17. 对局历史支持游标分页、模式/结果筛选和本人隐私边界。
18. 普通回放从规则快照重演，检查点哈希全部一致。

### 前端

19. 首页右侧不再出现 Agent；PVE、PVP 入口语义明确。
20. 匹配、确认、加载、重连、投降、结算和再来一局都有明确状态。
21. 结算页展示胜负原因、段位变化、奖励和关键统计，不使用客户端估算。
22. 排行榜不再展示真人/Agent 双榜或 PVE 最高波次。
23. 记录页能打开摘要与回放；无权限、已过期、无效局均有正确空状态。
