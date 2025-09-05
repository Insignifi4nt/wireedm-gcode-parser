/**
 * EventHistory - tracks recent events for debugging/observability
 */
export class EventHistory {
  constructor(maxHistorySize = 100) {
    this.maxHistorySize = maxHistorySize;
    this._events = [];
  }

  record(type, data, listeners) {
    this._events.push({ type, data, timestamp: Date.now(), listeners });
    if (this._events.length > this.maxHistorySize) {
      this._events.shift();
    }
  }

  getEvents() {
    return [...this._events];
  }

  clear() {
    this._events.length = 0;
  }
}

