"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PVE_STAGE_CATALOG_REVISION = exports.PVE_BALANCE_CATALOG_REVISION = exports.PVE_MATCH_CONFIG_SNAPSHOT_SCHEMA_VERSION = exports.PVE_COMBAT_RULESET_VERSION = void 0;
exports.createPveMatchConfigSnapshot = createPveMatchConfigSnapshot;
const pve_stage_config_1 = require("../../../shared/contracts/pve-stage-config");
/**
 * 新版 PVE 的稳定规则身份。任何破坏确定性回放/结算口径的规则变更都必须升级此值。
 * 旧版波次调度器没有这个身份，因此不能伪装成新版对局。
 */
exports.PVE_COMBAT_RULESET_VERSION = 'pve-v2.3.0';
exports.PVE_MATCH_CONFIG_SNAPSHOT_SCHEMA_VERSION = 1;
exports.PVE_BALANCE_CATALOG_REVISION = 'pve-balance-2026-08-25-v3';
exports.PVE_STAGE_CATALOG_REVISION = 'pve-stage-2026-08-25-v1';
function createPveMatchConfigSnapshot(input) {
    const stage = (0, pve_stage_config_1.getPveStageDefinition)(input.levelId);
    if (!stage)
        throw new Error(`PVE_V2_STAGE_NOT_FOUND:${input.levelId}`);
    return Object.freeze({
        schemaVersion: exports.PVE_MATCH_CONFIG_SNAPSHOT_SCHEMA_VERSION,
        runtimeKind: 'pve-v2',
        combatRulesetVersion: exports.PVE_COMBAT_RULESET_VERSION,
        stageCatalogRevision: exports.PVE_STAGE_CATALOG_REVISION,
        balanceCatalogRevision: exports.PVE_BALANCE_CATALOG_REVISION,
        stageId: stage.stageId,
        levelId: input.levelId,
        difficulty: input.difficulty,
        balanceProfileId: input.balanceProfile.profileId,
        tickRateMs: input.tickRateMs,
        prepDurationMs: input.prepDurationMs,
        maxWaves: input.maxWaves,
        initialWaveNumber: input.initialWaveNumber,
    });
}
