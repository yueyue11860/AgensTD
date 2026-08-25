"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runGeneralRosterSmokeChecks = runGeneralRosterSmokeChecks;
const strict_1 = __importDefault(require("node:assert/strict"));
const roster_1 = require("./roster");
function runGeneralRosterSmokeChecks() {
    (0, roster_1.validateGeneralRoster)();
    strict_1.default.equal(roster_1.GENERAL_ROSTER.length, 21);
    strict_1.default.deepEqual(roster_1.GENERAL_ROSTER.reduce((counts, entry) => {
        counts[entry.profession] = (counts[entry.profession] ?? 0) + 1;
        return counts;
    }, {}), { physical: 6, magic: 5, summon: 4, control: 6 });
    strict_1.default.equal((0, roster_1.getGeneralRosterEntry)(roster_1.GENERAL_IDS.HOUYI)?.displayName, '后羿');
    strict_1.default.equal((0, roster_1.getGeneralRosterEntry)(roster_1.GENERAL_IDS.CHANG_E)?.displayName, '嫦娥');
    strict_1.default.equal((0, roster_1.getGeneralRosterEntry)(roster_1.GENERAL_IDS.YANGJIAN)?.displayName, '杨戬');
    strict_1.default.equal((0, roster_1.getGeneralRosterEntry)(roster_1.GENERAL_IDS.NAZHA)?.displayName, '哪吒');
    strict_1.default.equal((0, roster_1.getGeneralRosterEntry)(roster_1.GENERAL_IDS.LIJING)?.displayName, '李靖');
    strict_1.default.equal((0, roster_1.getGeneralRosterEntry)(roster_1.GENERAL_IDS.SUNWUKONG)?.displayName, '孙悟空');
    strict_1.default.equal((0, roster_1.getGeneralRosterEntry)('unknown_general'), null);
    strict_1.default.throws(() => (0, roster_1.validateGeneralRoster)(roster_1.GENERAL_ROSTER.slice(0, 20)), /exactly 21 entries/);
    const duplicateIdRoster = roster_1.GENERAL_ROSTER.map((entry) => ({ ...entry }));
    duplicateIdRoster[1] = {
        ...duplicateIdRoster[1],
        generalId: duplicateIdRoster[0].generalId,
    };
    strict_1.default.throws(() => (0, roster_1.validateGeneralRoster)(duplicateIdRoster), /Duplicate generalId/);
    const duplicateRecipeRoster = roster_1.GENERAL_ROSTER.map((entry) => ({ ...entry }));
    duplicateRecipeRoster[1] = {
        ...duplicateRecipeRoster[1],
        glyphs: [...duplicateRecipeRoster[0].glyphs],
    };
    strict_1.default.throws(() => (0, roster_1.validateGeneralRoster)(duplicateRecipeRoster), /Duplicate general recipe/);
    const wrongQualityRoster = roster_1.GENERAL_ROSTER.map((entry) => ({ ...entry }));
    wrongQualityRoster[0] = {
        ...wrongQualityRoster[0],
        quality: 'red',
    };
    strict_1.default.throws(() => (0, roster_1.validateGeneralRoster)(wrongQualityRoster), /invalid 2-glyph quality/);
    const wrongProfessionCountRoster = roster_1.GENERAL_ROSTER.map((entry) => ({ ...entry }));
    wrongProfessionCountRoster[0] = {
        ...wrongProfessionCountRoster[0],
        profession: 'magic',
    };
    strict_1.default.throws(() => (0, roster_1.validateGeneralRoster)(wrongProfessionCountRoster), /profession physical/);
}
if (require.main === module) {
    runGeneralRosterSmokeChecks();
    console.log('hero-v1 roster smoke checks passed');
}
