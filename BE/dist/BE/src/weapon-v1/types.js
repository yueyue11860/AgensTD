"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WeaponDomainError = exports.WEAPON_FRAGMENT_REQUIREMENT = void 0;
exports.WEAPON_FRAGMENT_REQUIREMENT = {
    green: 1,
    blue: 2,
    purple: 3,
    orange: 4,
    red: 5,
};
class WeaponDomainError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'WeaponDomainError';
    }
}
exports.WeaponDomainError = WeaponDomainError;
