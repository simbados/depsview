/**
 * Async semaphore for bounding concurrent operations.
 * Callers await acquire() before the guarded work and call release() when done.
 * The semaphore passes the slot directly to the next waiter on release so the
 * count never dips below the limit unnecessarily.
 */

/**
 * A simple async semaphore that limits the number of concurrent operations.
 * @example
 *   const sem = new Semaphore(5);
 *   await sem.acquire();
 *   try { await doWork(); } finally { sem.release(); }
 */
class Semaphore {
  /**
   * @param {number} limit - maximum number of concurrent holders
   */
  constructor(limit) {
    this.limit = limit;
    this.count = 0;
    /** @type {Array<() => void>} */
    this.queue = [];
  }

  /**
   * Waits until a concurrency slot is available, then acquires it.
   * Returns immediately when below the limit; otherwise queues the caller.
   * @returns {Promise<void>}
   */
  acquire() {
    if (this.count < this.limit) {
      this.count++;
      return Promise.resolve();
    }
    return new Promise(resolve => this.queue.push(resolve));
  }

  /**
   * Releases the current slot.
   * If callers are queued, passes the slot directly to the next one
   * without decrementing, keeping the count stable.
   */
  release() {
    if (this.queue.length > 0) {
      this.queue.shift()();
    } else {
      this.count--;
    }
  }
}

export { Semaphore };
