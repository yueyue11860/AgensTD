"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PveCheckpointStoreError = void 0;
class PveCheckpointStoreError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'PveCheckpointStoreError';
    }
}
exports.PveCheckpointStoreError = PveCheckpointStoreError;
