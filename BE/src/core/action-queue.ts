import type { QueuedAction } from '../domain/actions'

export class ActionQueue {
  private readonly queue: QueuedAction[] = []

  enqueue(action: QueuedAction) {
    this.queue.push(action)
  }

  drain(): QueuedAction[] {
    return this.queue.splice(0, this.queue.length)
  }

  size() {
    return this.queue.length
  }
}