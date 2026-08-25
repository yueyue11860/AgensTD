"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountDomainError = exports.PLAYER_ACCOUNT_SCHEMA_VERSION = void 0;
exports.PLAYER_ACCOUNT_SCHEMA_VERSION = 1;
class AccountDomainError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'AccountDomainError';
    }
}
exports.AccountDomainError = AccountDomainError;
