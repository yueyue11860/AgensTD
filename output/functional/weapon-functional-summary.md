# 武器实装与真实前端交互专项（2026-08-28）

## 结论

武器局外主链可用，但武器战斗实装不完整，专项结论为 **No-Go**。

- 真实 Chromium + 真实 REST：41/41 武器卡展示，41/41 图片加载成功；青钢刀从 1/1 碎片合成，后羿双槽装备并保存，刷新后持久化成功。
- 真实服务端房间：UI 创建房间、下达军令并进入 PVE；对局快照锁定 `青钢刀 + 射日神弓`。对局创建后把账户改为 `青钢刀 + 追风弓`，旧对局仍保持原双槽，冻结通过。
- 真实 PVE runtime：无武器后羿攻击 34、间隔 1350ms、射程 3000；`青钢刀 + 追风弓` 后为 36、1228ms、3250，双武器属性叠加生效。
- UI 保存的 `青钢刀 + 射日神弓` 进入 runtime 后，攻击为 36；专武参数将额外目标数改为 2，并真实产生 80%/60% 两次追加伤害事件。
- 目录共 41 件且每件都有定义，但仅 16 件的声明效果被当前 runtime 全部消费，3 件仅部分消费，22 件为战斗空壳；全部 41 件仍标记 `testing`，0 件为 `released`。

## 覆盖统计

| 项目 | 结果 |
| --- | ---: |
| 武器目录 / UI 卡片 | 41 / 41 |
| 图片资源正常 | 41 / 41 |
| 至少一个效果定义 | 41 / 41 |
| 至少适配一名神将 | 41 / 41 |
| runtime 全量消费 | 16 / 41（39.0%） |
| runtime 部分消费 | 3 / 41（7.3%） |
| runtime 完全不消费 | 22 / 41（53.7%） |
| released | 0 / 41 |
| testing | 41 / 41 |
| 配置 uniqueGroup | 0 / 41 |

“全量消费”按 runtime 自己的支持判定统计：属性修饰器、`on_basic_attack_hit + apply_status`，以及后羿专武补丁。runtime 会对其他触发器/补丁发出 `WEAPON_EFFECT_UNSUPPORTED`，因此不能按“目录里有 JSON”算实装。

## 缺陷

### P1：22 件武器为可展示、可合成/装备的战斗空壳

`thunder_fire_talisman`、`nine_luminary_wheel`、`boundary_stele`、`yangjian_divine_trident`、`nazha_fire_tip_spear`、`sha_wujing_demon_staff`、`zhu_bajie_supreme_rake`、`jade_emperor_celestial_seal`、`lei_gong_thunder_chisel`、`dian_mu_lightning_mirror`、`zhen_yuanzi_book_of_earth`、`ru_lai_five_finger_seal`、`pu_ti_lingtai_staff`、`chang_e_guanghan_moonwheel`、`sunwukong_ruyi_jingu_bang`、`taiyi_nine_dragon_fire_hood`、`shouxing_longevity_staff`、`tang_sanzang_khakkhara`、`bai_longma_sea_dragon_pearl`、`pi_lanpo_sun_needle`、`guanyin_jade_purifying_vase`、`laojun_purple_gold_furnace`。

代码证据：`BE/src/pve-v2/runtime.ts:3581-3593` 明确仅支持一种 trigger 与后羿补丁，其余发出不支持事件。

### P1：3 件武器效果仅部分生效，文案会误导玩家

- `sun_piercing_bow`：攻击 -8% 生效，贯穿与 70% 次级伤害被 runtime 报不支持。
- `chaos_umbrella`：硬控 -30% 生效，15% 易损触发不支持。
- `lijing_pagoda`：天兵上限 +1 生效，第 3 次普攻剑气不支持。

### P1：全部 41 件 testing 武器无门禁暴露给玩家

目录工厂固定写入 `status: 'testing'`（`BE/src/weapon-v1/catalog.ts:68,121`），但账户目录与前端没有按状态过滤，所有武器均进入玩家武库。

### P2：合成或保存后当前神将跳回列表第一名

真实 UI 中选择后羿后，合成成功跳回杨戬；再次选择后羿保存双武器后又跳回杨戬。原因是 mutation 后 `refresh()` 把 `isLoading` 设为 true（`FE/hooks/use-player-account.ts:355-380`），页面条件渲染卸载并重建 `ArsenalView`（`FE/pages/meta-system-page.tsx:384-388`），其 `generalId` 初始值总是 `generals[0]`（`FE/pages/meta-system-page.tsx:263`）。

### P2：唯一组冲突规则无法在产品目录验证

服务端有 `UNIQUE_GROUP_CONFLICT` 校验（`BE/src/weapon-v1/account.ts:90-91`），但 41 件武器没有任何一件配置 `uniqueGroup`。因此玩家路径不存在可触发组合，专项要求中的唯一组拒绝无法执行；这是目录缺口/死分支，而不是通过。

## 已通过的拒绝路径

真实 REST 返回：

- 流派不兼容：422 `WEAPON_INCOMPATIBLE`
- 专武错配：422 `EXCLUSIVE_GENERAL_MISMATCH`
- 双槽重复：422 `DUPLICATE_WEAPON_IN_LOADOUT`
- 未解锁武器：422 `WEAPON_NOT_UNLOCKED`

## 证据文件

- `weapon-runtime-report.json`：运行时属性、专武伤害事件、完整 41 件分类矩阵。
- `weapon-ui/04-account-after-ui.json`：真实 UI 合成与双槽保存后的账户。
- `weapon-ui/05-server-rejections.json`：四类服务端拒绝。
- `weapon-ui/07-real-server-match-snapshot.json`：真实房间对局锁定的武器快照。
- `weapon-ui/08-real-server-snapshot-freeze.json`：账户变更后旧对局快照未变化。
- `weapon-ui/01-arsenal-catalog.png`、`02-craft-success-selection-reset.png`、`03-dual-save-success-selection-reset.png`、`06-reload-persisted-dual-loadout.png`、`09-real-server-match-ended.png`：UI 截图。

测试使用内存账户与仅测试进程内 preload 注入初始碎片/解锁，不修改产品源码，也不写远程账户。
