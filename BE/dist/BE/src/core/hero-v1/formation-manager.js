"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeneralFormationManager = void 0;
const catalog_1 = require("./catalog");
const generalKey = (ownerPlayerId, generalId) => `${ownerPlayerId}:${generalId}`;
const cellKey = (x, y) => `${x},${y}`;
const cloneFormation = (formation) => ({
    ...formation,
    characterTokenIds: [...formation.characterTokenIds],
    cells: formation.cells.map((cell) => ({ ...cell })),
    anchorMilli: { ...formation.anchorMilli },
});
const cloneProgress = (progress) => ({ ...progress });
class GeneralFormationManager {
    catalog;
    activeByOwnerAndGeneral = new Map();
    progressByOwnerAndGeneral = new Map();
    formationSequence = 0;
    constructor(catalog = catalog_1.GENERAL_CATALOG) {
        this.catalog = catalog;
    }
    reconcilePlayer(ownerPlayerId, boardCharacters, nonGeneralPopulationUsed, populationCap, currentTick) {
        const candidates = this.detectCandidates(ownerPlayerId, boardCharacters);
        const populationUsed = nonGeneralPopulationUsed + candidates.length;
        const previous = this.getActiveFormations(ownerPlayerId);
        if (populationUsed > populationCap) {
            return {
                ok: false,
                code: 'POPULATION_LIMIT',
                activeFormations: previous,
                activatedGeneralIds: [],
                deactivatedGeneralIds: [],
                populationUsed: nonGeneralPopulationUsed + previous.length,
                blockedGeneralId: candidates.at(-1)?.definition.generalId,
            };
        }
        const previousIds = new Set(previous.map((formation) => formation.generalId));
        const nextIds = new Set(candidates.map((candidate) => candidate.definition.generalId));
        const nextFormations = [];
        for (const candidate of candidates) {
            const key = generalKey(ownerPlayerId, candidate.definition.generalId);
            const existing = this.activeByOwnerAndGeneral.get(key);
            const tokenIds = candidate.tokens.map((token) => token.tokenId);
            const cells = candidate.tokens.map(({ x, y }) => ({ x, y }));
            const sameFootprint = existing
                && existing.characterTokenIds.join('|') === tokenIds.join('|')
                && existing.cells.every((cell, index) => cell.x === cells[index].x && cell.y === cells[index].y);
            const formation = existing
                ? {
                    ...existing,
                    characterTokenIds: tokenIds,
                    cells,
                    anchorMilli: this.calculateAnchorMilli(cells),
                    revision: sameFootprint ? existing.revision : existing.revision + 1,
                }
                : {
                    formationId: this.nextFormationId(ownerPlayerId, candidate.definition.generalId),
                    ownerPlayerId,
                    generalId: candidate.definition.generalId,
                    characterTokenIds: tokenIds,
                    cells,
                    anchorMilli: this.calculateAnchorMilli(cells),
                    fixed: false,
                    active: true,
                    revision: 1,
                };
            this.activeByOwnerAndGeneral.set(key, formation);
            nextFormations.push(formation);
            if (!this.progressByOwnerAndGeneral.has(key)) {
                this.progressByOwnerAndGeneral.set(key, this.createProgress(ownerPlayerId, candidate.definition, currentTick));
            }
        }
        for (const previousFormation of previous) {
            if (!nextIds.has(previousFormation.generalId)) {
                this.activeByOwnerAndGeneral.delete(generalKey(ownerPlayerId, previousFormation.generalId));
            }
        }
        return {
            ok: true,
            code: 'OK',
            activeFormations: nextFormations.map(cloneFormation),
            activatedGeneralIds: [...nextIds].filter((generalId) => !previousIds.has(generalId)).sort(),
            deactivatedGeneralIds: [...previousIds].filter((generalId) => !nextIds.has(generalId)).sort(),
            populationUsed,
        };
    }
    getActiveFormations(ownerPlayerId) {
        return [...this.activeByOwnerAndGeneral.values()]
            .filter((formation) => formation.ownerPlayerId === ownerPlayerId)
            .sort((left, right) => left.generalId.localeCompare(right.generalId))
            .map(cloneFormation);
    }
    getFormation(formationId) {
        const formation = [...this.activeByOwnerAndGeneral.values()]
            .find((candidate) => candidate.formationId === formationId);
        return formation ? cloneFormation(formation) : null;
    }
    getProgress(ownerPlayerId, generalId) {
        const progress = this.progressByOwnerAndGeneral.get(generalKey(ownerPlayerId, generalId));
        return progress ? cloneProgress(progress) : null;
    }
    getAllProgress(ownerPlayerId) {
        return [...this.progressByOwnerAndGeneral.values()]
            .filter((progress) => progress.ownerPlayerId === ownerPlayerId)
            .sort((left, right) => left.generalId.localeCompare(right.generalId))
            .map(cloneProgress);
    }
    setFixed(ownerPlayerId, formationId, fixed) {
        const entry = [...this.activeByOwnerAndGeneral.entries()]
            .find(([, formation]) => formation.ownerPlayerId === ownerPlayerId && formation.formationId === formationId);
        if (!entry) {
            return null;
        }
        const [key, formation] = entry;
        const next = { ...formation, fixed, revision: formation.revision + 1 };
        this.activeByOwnerAndGeneral.set(key, next);
        return cloneFormation(next);
    }
    planFixedFormationMove(ownerPlayerId, formationId, targetStart, isDeployable, isOccupied) {
        const formation = [...this.activeByOwnerAndGeneral.values()]
            .find((candidate) => candidate.ownerPlayerId === ownerPlayerId && candidate.formationId === formationId);
        if (!formation) {
            return { ok: false, code: 'FORMATION_NOT_FOUND', tokenMoves: [] };
        }
        if (!formation.fixed) {
            return { ok: false, code: 'FORMATION_NOT_FIXED', tokenMoves: [] };
        }
        const sourceCells = new Set(formation.cells.map((cell) => cellKey(cell.x, cell.y)));
        const destinations = formation.cells.map((_, index) => ({ x: targetStart.x + index, y: targetStart.y }));
        if (destinations.some((cell) => !isDeployable(cell.x, cell.y)
            || (isOccupied(cell.x, cell.y) && !sourceCells.has(cellKey(cell.x, cell.y))))) {
            return { ok: false, code: 'INVALID_TARGET', tokenMoves: [] };
        }
        return {
            ok: true,
            code: 'OK',
            tokenMoves: formation.characterTokenIds.map((tokenId, index) => ({
                tokenId,
                from: { ...formation.cells[index] },
                to: destinations[index],
            })),
        };
    }
    addExperience(ownerPlayerId, generalId, experiencePoints) {
        if (!Number.isSafeInteger(experiencePoints) || experiencePoints < 0) {
            throw new Error('General experience must be a non-negative safe integer');
        }
        const key = generalKey(ownerPlayerId, generalId);
        const progress = this.progressByOwnerAndGeneral.get(key);
        const definition = this.catalog[generalId];
        if (!progress || !definition) {
            return null;
        }
        const nextExperience = progress.experiencePoints + experiencePoints;
        const next = {
            ...progress,
            experiencePoints: nextExperience,
            level: (0, catalog_1.levelForExperience)(definition, nextExperience, progress.maxLevel),
            fullRankExperiencePoints: Math.min(nextExperience, (0, catalog_1.fullRankExperienceRequired)(definition)),
        };
        this.progressByOwnerAndGeneral.set(key, next);
        return cloneProgress(next);
    }
    setBreakthrough(ownerPlayerId, generalId, enabled) {
        const key = generalKey(ownerPlayerId, generalId);
        const progress = this.progressByOwnerAndGeneral.get(key);
        const definition = this.catalog[generalId];
        if (!progress || !definition) {
            return null;
        }
        const maxLevel = (enabled
            ? definition.levelRules.breakthroughMaxLevel
            : definition.levelRules.defaultMaxLevel);
        const next = {
            ...progress,
            maxLevel,
            level: (0, catalog_1.levelForExperience)(definition, progress.experiencePoints, maxLevel),
        };
        this.progressByOwnerAndGeneral.set(key, next);
        return cloneProgress(next);
    }
    replaceProgress(nextProgress) {
        if (!this.catalog[nextProgress.generalId]) {
            throw new Error(`Unknown general progress: ${nextProgress.generalId}`);
        }
        this.progressByOwnerAndGeneral.set(generalKey(nextProgress.ownerPlayerId, nextProgress.generalId), cloneProgress(nextProgress));
    }
    detectCandidates(ownerPlayerId, boardCharacters) {
        const tokens = boardCharacters
            .filter((token) => token.ownerPlayerId === ownerPlayerId)
            .sort((left, right) => left.y - right.y || left.x - right.x || left.tokenId.localeCompare(right.tokenId));
        const tokenAt = new Map(tokens.map((token) => [cellKey(token.x, token.y), token]));
        const consumedTokenIds = new Set();
        const definitions = Object.values(this.catalog).sort((left, right) => {
            return right.recipe.glyphs.length - left.recipe.glyphs.length
                || right.recipe.priority - left.recipe.priority
                || left.generalId.localeCompare(right.generalId);
        });
        const candidates = [];
        const activeGeneralIds = new Set();
        for (const definition of definitions) {
            if (activeGeneralIds.has(definition.generalId)) {
                continue;
            }
            for (const start of tokens) {
                const recipeTokens = definition.recipe.glyphs.map((glyph, index) => {
                    const token = tokenAt.get(cellKey(start.x + index, start.y));
                    return token?.glyph === glyph ? token : null;
                });
                if (recipeTokens.some((token) => token === null)) {
                    continue;
                }
                const matchedTokens = recipeTokens;
                if (matchedTokens.some((token) => consumedTokenIds.has(token.tokenId))) {
                    continue;
                }
                matchedTokens.forEach((token) => consumedTokenIds.add(token.tokenId));
                activeGeneralIds.add(definition.generalId);
                candidates.push({ definition, tokens: matchedTokens });
                break;
            }
        }
        return candidates.sort((left, right) => left.definition.generalId.localeCompare(right.definition.generalId));
    }
    calculateAnchorMilli(cells) {
        const xMilli = cells.reduce((sum, cell) => sum + cell.x * 1000, 0) / cells.length;
        const yMilli = cells.reduce((sum, cell) => sum + cell.y * 1000, 0) / cells.length;
        return { x: Math.round(xMilli), y: Math.round(yMilli) };
    }
    createProgress(ownerPlayerId, definition, currentTick) {
        return {
            progressId: `general-progress:${ownerPlayerId}:${definition.generalId}`,
            ownerPlayerId,
            generalId: definition.generalId,
            firstActivatedAtTick: currentTick,
            experiencePoints: 0,
            level: definition.levelRules.initialLevel,
            maxLevel: definition.levelRules.defaultMaxLevel,
            fullRankExperiencePoints: 0,
            hasTriggeredFirstActivationReward: true,
            nextBasicAttackTick: 0,
            activeSkillReadyAtTick: 0,
        };
    }
    nextFormationId(ownerPlayerId, generalId) {
        this.formationSequence += 1;
        return `general-formation:${ownerPlayerId}:${generalId}:${this.formationSequence}`;
    }
}
exports.GeneralFormationManager = GeneralFormationManager;
