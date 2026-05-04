import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Semaphore } from '../../src/util/semaphore.js';

describe('Semaphore — basic acquire/release', () => {
  it('allows immediate acquire when below limit', async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    assert.equal(sem.count, 1);
  });

  it('count reaches limit after N acquires', async () => {
    const sem = new Semaphore(3);
    await sem.acquire();
    await sem.acquire();
    await sem.acquire();
    assert.equal(sem.count, 3);
  });

  it('release decrements count when no queue', async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    sem.release();
    assert.equal(sem.count, 0);
  });

  it('count stays at limit while waiters are queued', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    // This acquire should queue, not resolve yet
    let resolved = false;
    sem.acquire().then(() => { resolved = true; sem.release(); });
    assert.equal(resolved, false);
    assert.equal(sem.queue.length, 1);
    sem.release();
    // yield to microtask queue so the queued resolve fires
    await Promise.resolve();
    assert.equal(resolved, true);
    assert.equal(sem.queue.length, 0);
  });
});

describe('Semaphore — concurrency cap', () => {
  it('never exceeds the limit under concurrent load', async () => {
    const limit = 3;
    const sem = new Semaphore(limit);
    let active = 0;
    let maxSeen = 0;

    const tasks = Array.from({ length: 10 }, () =>
      (async () => {
        await sem.acquire();
        active++;
        maxSeen = Math.max(maxSeen, active);
        await new Promise(r => setTimeout(r, 0));
        active--;
        sem.release();
      })()
    );

    await Promise.all(tasks);
    assert.ok(maxSeen <= limit, `maxSeen ${maxSeen} exceeded limit ${limit}`);
  });

  it('resolves all tasks even under pressure', async () => {
    const sem = new Semaphore(2);
    let completed = 0;
    const tasks = Array.from({ length: 8 }, () =>
      (async () => {
        await sem.acquire();
        completed++;
        sem.release();
      })()
    );
    await Promise.all(tasks);
    assert.equal(completed, 8);
  });
});
