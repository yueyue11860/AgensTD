# 道具实装与前端真实交互专项（2026-08-28）

## 结论

- 目录：23/23 在局外构筑 UI 可见（主动 8、被动 15）。
- 新账号可装备：5/23（主动 2、被动 3）；其余 18 个正确显示为锁定，不能在本轮新账号直接装备。
- 本轮真实浏览器成功保存默认构筑，服务端账户版本由 v1 升至 v2。
- 冻结快照：2 个默认主动均进入对局；行军灶使初始斋饭 10→15，备战符使备战席 2→3；招贤榜在首个真实付费招募中产出 1 个字符（服务端规则概率为 1200 bps，但单次样本只证明规则参与与可产出，不证明统计概率）。人口仍为 10，符合默认未装备扩军令。
- 点将笔：真实 UI 依次点击“召唤”→“点将笔”→托盘字符“李”，服务端 `ACTIVE_ITEM_USED`；次数 2→1、runtime version 1→2、李进入弃置区、托盘替换为祖，冷却截止 tick=47。结果为通过。
- 修为丹：局外可装备、对局可见；本轮浏览器没有在败北前形成合法神将，因此没有完成“UI 合法目标”成功分支。直接运行时纵向测试已验证经验增加、次数扣减、重复 request 不重复加经验。
- 动态运行时证据覆盖：主动 4/8（点将笔、修为丹、再征令、天雷令），被动 15/15（规则投影/事件/战斗 modifier）；其余 4 个主动仅确认目录 payload、通用前端目标路由与服务端执行分支存在，未在本轮动态命中，不能记为实战通过。

## 主动道具矩阵

| 道具 | UI 可见 | 新账号可装备 | UI 可使用 | 动态效果证据 | 本轮结论 |
|---|---:|---:|---:|---|---|
| 点将笔 | 是 | 是 | 是 | 真浏览器成功；李→祖，李入弃置，2→1 次，`ACTIVE_ITEM_USED` | 通过 |
| 修为丹 | 是 | 是 | 目标路由可用 | runtime：神将经验增加，重复 request 不重复生效 | UI 合法目标分支未完成 |
| 神将符 | 是 | 否（锁定） | 前端支持 active_general | 未动态命中 | 未验证 |
| 再征令 | 是 | 否（锁定） | 前端支持 none | economy runtime：免费刷新兼容检查通过 | 运行时通过 / UI 锁定 |
| 招魂幡 | 是 | 否（锁定） | 前端支持弃置字符→空位 | 未动态命中 | 未验证 |
| 天雷令 | 是 | 否（锁定） | 前端支持战场点 | runtime：非法空目标不扣次数；full-build 命中覆盖存在 | 运行时部分通过 / UI 锁定 |
| 定风符 | 是 | 否（锁定） | 前端支持战场点 | 未动态命中 | 未验证 |
| 战鼓令 | 是 | 否（锁定） | 前端支持 active_general | 未动态命中 | 未验证 |

## 被动道具矩阵

| 道具 | UI 可见 | 新账号可装备 | 动态效果证据 | 结论 |
|---|---:|---:|---|---|
| 行军灶 | 是 | 是 | 真对局初始斋饭 10→15 | 通过 |
| 招贤榜 | 是 | 是 | 真招募产出字符；规则投影 1200 bps | 通过（概率需大样本） |
| 备战符 | 是 | 是 | 真对局备战席 2→3 | 通过 |
| 节用令 | 是 | 否 | runtime：9→8、最低 5 | 通过 / UI 锁定 |
| 余粮袋 | 是 | 否 | runtime 目录/事件监听已注册 | 通过（投影） |
| 求贤令 | 是 | 否 | runtime：连续两批无字符后第三批保底 | 通过 |
| 扩军令 | 是 | 否 | runtime：人口上限 10→11 | 通过 |
| 紫府破境 | 是 | 否 | runtime：紫将等级上限→5 | 通过 |
| 橙府破境 | 是 | 否 | runtime：橙将等级上限→5 | 通过 |
| 师门秘卷 | 是 | 否 | runtime：1001 经验→1151 | 通过 |
| 破军旗 | 是 | 否 | combat modifier 投影存在 | 通过（投影） |
| 玄法印 | 是 | 否 | combat modifier 投影存在 | 通过（投影） |
| 万灵幡 | 是 | 否 | 两个 combat modifier 投影存在 | 通过（投影） |
| 定界珠 | 是 | 否 | combat modifier 投影存在 | 通过（投影） |
| 寻宝罗盘 | 是 | 否 | 1999/10000 命中、2000 不命中的边界检查 | 通过 |

## 缺陷与风险

1. **P1 首局教学与战斗同时推进，可能在玩家完成教学/道具操作前败北。** 默认 100ms 主循环的首个真实房间中，教学卡片仍在前景时防线已经败北；点将笔目标选择也曾被结算层截断。教学文案明确“提示不会暂停战斗”，见 `FE/components/pve-onboarding-coach.tsx:45`；页面只控制提示显隐，不暂停 runtime，见 `FE/pages/gaming-page.tsx:1986`。建议首次教学阶段使用服务端 prep/暂停或至少延长首波准备时间。
2. **P2 18/23 道具对新账号不可装备，实战可达性依赖长期奖励/商店。** 这不是实现缺失，但阻止单个新账号在一次测试轮完整验证。默认解锁清单见 `BE/src/item-v1/account.ts:12`。
3. **覆盖风险：4 个主动道具缺少本轮动态命中。** 神将符、招魂幡、定风符、战鼓令虽有目录 payload、前端目标路由和服务端通用执行链，但没有真实效果证据，不能按“已实装通过”签字。

## 关键代码证据

- 构筑槽与保存：`FE/pages/meta-system-page.tsx:185-221`
- 主动道具 UI 路由：`FE/pages/gaming-page.tsx:1678-1732`
- 次数/冷却与按钮状态：`FE/pages/gaming-page.tsx:2214-2255`
- 服务端目标验证与 no-consume：`BE/src/pve-v2/runtime.ts:969-1053`
- 服务端动作执行：`BE/src/pve-v2/runtime.ts:1056`
- 默认解锁：`BE/src/item-v1/account.ts:12-31`

## 命令与证据

- 浏览器：Playwright CLI session（真实 Chromium headed），前端 `http://127.0.0.1:4411`，后端 `http://127.0.0.1:4410`。
- Runtime：`pnpm exec ts-node src/item-v1/smoke.ts`；`pnpm exec ts-node src/pve-v2/loadout-smoke.ts`；`pnpm exec ts-node src/pve-v2/economy-smoke.ts`。
- 截图：`02-default-loadout-catalog.png`、`04-match-snapshot-items-passives.png`、`05-brush-authoritative-success.png`、`06-passive-full-catalog.png`。
- 权威状态：`state-after-start.json`、`state-after-ui-brush-attempt.json`。
- 日志：`item-v1-runtime-smoke.log`、`pve-loadout-runtime-smoke.log`、`pve-economy-runtime-smoke.log`。

