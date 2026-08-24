# AgensTD Web 联机版目标架构

更新时间：2026-08-23

## 1. 当前阶段的结论

Web 联机版继续采用“权威服务端 + 无本地战斗结算客户端”：

- React 负责登录、房间、大厅、排行榜、选关和游戏外 UI。
- Phaser 负责 Web 战场 Canvas、地图、塔、敌人、动画、输入、粒子和音效。
- Node.js/TypeScript 服务端是唯一权威状态源，继续负责 Tick、波次、寻路、塔行为、伤害、金币、胜负和回放。
- Socket.IO 负责浏览器长连接；HTTPS/WSS 由腾讯云服务器上的 Nginx 终止 TLS 并反向代理。
- PostgreSQL 18 取代 Supabase 数据库；浏览器不再直连数据库，也不再依赖 Supabase Realtime。

## 2. 跨平台决策门

“微信小程序”和“微信小游戏”必须区分：

### 路线 A：微信小程序 WebView + Android WebView/Capacitor

继续使用 Phaser。优点是同一套 Web 客户端基本可以直接复用，开发速度最快。限制是微信侧属于内嵌 H5，不具备完整的微信小游戏发布、分包和开放数据域能力。

### 路线 B：微信原生小游戏 + Android 原生包

客户端应切换到 Cocos Creator 3.x。Cocos 官方构建链路覆盖 Web、微信小游戏和 Android；微信小游戏运行时并不是标准浏览器，Phaser 没有同等级的官方发布适配。

无论选择哪条路线，服务端协议、房间、数值、回放和数据库都保持不变。当前 Phaser Web 客户端可用于尽快验证数值；若确定走路线 B，应在大量美术动画制作前建立 Cocos 客户端，避免表现层资产重复接线。

## 3. 运行拓扑

```text
浏览器 / 后续客户端
        │ HTTPS + WSS
        ▼
腾讯云 Nginx
  ├── /          -> 前端静态文件
  ├── /api/*     -> Node.js REST API
  └── /socket.io -> Node.js Socket.IO
        │
        ▼
Node.js 权威游戏服务
  ├── RoomManager
  ├── GameLoop / GameEngine
  ├── ActionQueue + RateLimiter
  ├── ReplayRecorder
  ├── Auth / Session
  └── Persistence interfaces
        │
        ├── PostgreSQL 18
        └── Redis（第二阶段，多实例时再加）
```

## 4. 客户端边界

React 不应为每个敌人和地图格创建 DOM 节点。战斗页面只把以下数据传给 Phaser：

- 最新服务端快照或增量。
- 当前选中的塔型。
- 当前选中的塔 ID。
- 用户输入回调。

Phaser 客户端只允许：

- 把服务端坐标映射为画面坐标。
- 在两个服务端 Tick 之间插值移动。
- 播放攻击、受击、死亡、粒子和音效。
- 显示建造预览和范围。
- 将点击转换为标准动作并发送。

Phaser 客户端禁止自行决定：

- 是否有足够金币。
- 是否允许建造。
- 伤害、命中、掉落和胜负。
- 敌人真实位置和最终状态。

本地可以做预测性 UI，但服务器拒绝后必须回滚。

## 5. 网络协议

当前 Web 客户端已经收敛为单一 `TICK_UPDATE` 状态通道：

1. `JOIN_ROOM`：携带协议版本、房间和身份。
2. `ROOM_JOINED`：返回槽位、阶段和 `serverTime`。
3. `TICK_UPDATE { mode: 'full' }`：加入、重连或主动请求校准时发送完整状态。
4. `TICK_UPDATE { mode: 'patch' }`：常规广播只发送实体增量。
5. `TICK_UPDATE { mode: 'checkpoint' }`：每 5 秒发送全部动态实体，不重复静态地图和 UI 描述。
6. `REQUEST_FULL_STATE`：客户端缺失基准状态时主动请求完整快照。
7. `SEND_ACTION`：客户端携带 `requestId`、`clientTick` 和动作载荷。
8. `ACTION_ACCEPTED`：立即返回 `requestId`、动作队列 ID 和服务端 Tick。

旧的逐 Tick `SYNC_STATE` 和 `GAME_STATE` 全量广播已经移除。塔与敌人的创建、变化和删除通过同一增量包批量传输，客户端不再为每个实体建立单独的 Socket 事件。

建议参数：

- 权威 Tick：100ms。
- 状态广播：200ms（5Hz）。
- 客户端渲染：浏览器刷新率，通常 60 FPS。
- Phaser 敌人位置插值：220ms，覆盖一个广播周期和少量网络抖动。
- 动态状态校准：5 秒；静态地图仅在完整快照或地图实际变化时发送。
- 回放/数据库批量持久化：5 秒以及对局结束时立即写入。
- 心跳和断线重连：Socket.IO 自带心跳，业务层保留 5～15 秒重连席位。

## 6. 腾讯云免费数据库方案

推荐在现有腾讯云服务器自建 PostgreSQL 18。数据库软件本身免费、开源，不产生额外数据库授权费用，只占用已有云服务器的 CPU、内存和磁盘。

不推荐继续自建完整 Supabase，因为它还包含 PostgREST、GoTrue、Realtime、Storage 等多个服务，对小型单机服务器的资源和维护压力明显高于单独 PostgreSQL。

部署原则：

- PostgreSQL 只监听内网或 `127.0.0.1`，绝不将 5432 直接暴露到公网。
- Node.js 使用连接池访问数据库。
- 数据目录使用独立持久卷。
- 每日 `pg_dump`，保留至少 7 天；备份再同步到腾讯云 COS 或另一块磁盘。
- 数据库密码只放服务端环境变量，不进入前端构建。
- 每月安装当前大版本的最新安全修订版本。

第一阶段不必安装 Redis。单个 Node.js 进程可以使用内存房间和 Socket.IO adapter。只有出现以下情况时再增加 Redis：

- Node.js 需要多实例水平扩容。
- 房间可能被不同进程承载。
- Session 和在线状态不能随进程重启丢失。
- 需要跨进程发布 Socket.IO 消息。

## 7. Supabase 替换范围

现有 Supabase 能力按下面方式替换：

| Supabase 能力 | 腾讯云自建替代 |
|---|---|
| PostgreSQL 表 | PostgreSQL 18 |
| Realtime 排行榜 | Socket.IO `LEADERBOARD_UPDATED` |
| 服务端 Supabase SDK | `pg`/SQL Repository |
| 浏览器 Supabase SDK | 删除，统一调用本项目 REST/Socket API |
| 用户进度 | PostgreSQL `user_progress` |
| 回放 JSONB | PostgreSQL `match_replays`，大回放后续转 COS |
| 内存 OAuth Session | PostgreSQL Session；规模扩大后转 Redis |

服务端已经新增 `CompetitionStore` 和 `UserStore` 接口。后续只需增加 PostgreSQL 实现并在启动时通过 `DATABASE_URL` 选择，不需要修改游戏循环和网络 API。

## 8. 分阶段实施

### 阶段 1：Web 可玩版

- Phaser Canvas 替换 DOM 战场。
- 完成敌人插值、塔显示、血条、建造预览和点击。
- 保留现有服务端权威计算。
- 前后端生产构建和真实浏览器联调。

### 阶段 2：Web 产品化

- 弱网模拟和多房间压测；按压测结果决定是否引入二进制编码。
- 接入正式精灵图集、攻击特效、音效和对象池。
- 增加断线重连、延迟显示、弱网测试和多房间压测。
- PostgreSQL Repository、数据库迁移和备份脚本。
- Session 持久化，删除生产环境静态真人 Token。

### 阶段 3：腾讯云上线

- Nginx HTTPS/WSS。
- Node.js 使用 systemd 或容器编排守护。
- PostgreSQL 仅内网访问。
- 健康检查、日志轮转、CPU/内存/房间数监控。
- 自动备份和恢复演练。

### 阶段 4：微信与 Android

- 若走路线 A：复用 Phaser Web 构建，分别接入微信 WebView 和 Capacitor。
- 若走路线 B：创建 Cocos Creator 客户端，复用同一网络合同和服务端数值。
- 平台登录、支付、分享和排行榜通过 PlatformAdapter 隔离。
