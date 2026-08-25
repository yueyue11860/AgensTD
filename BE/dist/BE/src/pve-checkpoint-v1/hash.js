"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPveCheckpointPayload = hashPveCheckpointPayload;
const node_crypto_1 = __importDefault(require("node:crypto"));
function stable(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stable).join(',')}]`;
    return `{${Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
        .join(',')}}`;
}
function hashPveCheckpointPayload(payload) {
    return node_crypto_1.default.createHash('sha256').update(stable(payload)).digest('hex');
}
