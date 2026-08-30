"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runGeneralSelectionSmoke = runGeneralSelectionSmoke;
const strict_1 = __importDefault(require("node:assert/strict"));
const runtime_1 = require("./runtime");
/** Smoke coverage for account unlock + per-match selected-general character pools. */
function runGeneralSelectionSmoke() {
    const runtime = new runtime_1.PveGameRuntime({
        seed: 'general-selection-smoke',
        prepDurationMs: 0,
        maxWaves: 1,
        generalSelections: {
            player: { unlockedGeneralIds: ['houyi', 'chang_e'], selectedGeneralIds: ['houyi'] },
        },
    });
    strict_1.default.equal(runtime.registerPlayer('player', 'P1').ok, true);
    const snapshot = runtime.snapshot();
    const player = snapshot.players[0];
    strict_1.default.deepEqual(player.unlockedGeneralIds, ['chang_e', 'houyi']);
    strict_1.default.deepEqual(player.selectedGeneralIds, ['houyi']);
    strict_1.default.deepEqual(player.remainingCharacterTokens, { 后: 1, 羿: 1 });
    const invalid = new runtime_1.PveGameRuntime({ seed: 'invalid-selection' });
    strict_1.default.equal(invalid.registerPlayer('p', 'P1', {
        unlockedGeneralIds: ['houyi'], selectedGeneralIds: ['chang_e'],
    }).code, 'SELECTED_GENERAL_NOT_UNLOCKED');
}
if (require.main === module) {
    runGeneralSelectionSmoke();
    console.log('pve-v2 general selection smoke checks passed');
}
