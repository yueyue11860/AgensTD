"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PvpStoreError = void 0;
class PvpStoreError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'PvpStoreError';
    }
}
exports.PvpStoreError = PvpStoreError;
