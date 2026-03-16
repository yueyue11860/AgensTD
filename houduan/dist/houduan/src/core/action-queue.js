"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActionQueue = void 0;
class ActionQueue {
    queue = [];
    enqueue(action) {
        this.queue.push(action);
    }
    drain() {
        return this.queue.splice(0, this.queue.length);
    }
    size() {
        return this.queue.length;
    }
}
exports.ActionQueue = ActionQueue;
