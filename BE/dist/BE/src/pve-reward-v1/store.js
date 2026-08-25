"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PveRewardStoreConflictError = void 0;
class PveRewardStoreConflictError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'PveRewardStoreConflictError';
    }
}
exports.PveRewardStoreConflictError = PveRewardStoreConflictError;
