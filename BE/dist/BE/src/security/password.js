"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PASSWORD_ALGORITHM_VERSION = exports.PASSWORD_ALGORITHM = void 0;
exports.createPasswordCredential = createPasswordCredential;
exports.verifyPassword = verifyPassword;
const node_crypto_1 = require("node:crypto");
exports.PASSWORD_ALGORITHM = 'scrypt';
exports.PASSWORD_ALGORITHM_VERSION = 1;
function createPasswordCredential(password, updatedAt = new Date().toISOString()) {
    const salt = (0, node_crypto_1.randomBytes)(16);
    return {
        algorithm: exports.PASSWORD_ALGORITHM,
        version: exports.PASSWORD_ALGORITHM_VERSION,
        saltHex: salt.toString('hex'),
        hashHex: (0, node_crypto_1.scryptSync)(password, salt, 32).toString('hex'),
        updatedAt,
    };
}
function verifyPassword(password, credential) {
    if (credential.algorithm !== exports.PASSWORD_ALGORITHM || credential.version !== exports.PASSWORD_ALGORITHM_VERSION)
        return false;
    try {
        const salt = Buffer.from(credential.saltHex, 'hex');
        const expected = Buffer.from(credential.hashHex, 'hex');
        if (salt.length !== 16 || expected.length !== 32)
            return false;
        const actual = (0, node_crypto_1.scryptSync)(password, salt, expected.length);
        return (0, node_crypto_1.timingSafeEqual)(actual, expected);
    }
    catch {
        return false;
    }
}
