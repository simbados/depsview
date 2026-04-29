/**
 * Recursive dependency resolver.
 * Starting from direct dependencies, fetches each package from PyPI, resolves the best
 * matching version, then enqueues that version's own dependencies (requires_dist).
 * Cycle detection is handled by a `pending` Map that marks packages as in-flight
 * before any awaiting begins, so circular deps are skipped automatically.
 * A Semaphore limits concurrent HTTP requests to avoid overwhelming PyPI.
 */

import { fetchPackageInfo, fetchVersionInfo, getVersionList, getReleaseDate, getReleaseCount, getFirstReleaseDate, normalizePackageName } from './pypiClient.js';
import { fetchDownloadStats } from './pypiStatsClient.js';
import { resolveVersion } from './versionResolver.js';
import { parseRequiresDist } from './parserCore.js';

const CONCURRENCY = 5;

/**
 * A simple async semaphore that limits the number of concurrent operations.
 * Callers must `await acquire()` before the guarded work and call `release()` when done.
 * The semaphore is released *before* recursing into child dependencies to prevent deadlock.
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
   * Waits until a slot is available, then acquires it.
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
   * Releases a slot and wakes the next waiting caller, if any.
   */
  release() {
    if (this.queue.length > 0) {
      // Pass the slot directly to the next waiter without decrementing
      const next = this.queue.shift();
      next();
    } else {
      this.count--;
    }
  }
}

/**
 * Resolves the complete transitive dependency graph of a Python project.
 *
 * Algorithm:
 *   - For each dep, create a Promise and record it in `pending` *before* awaiting,
 *     so any later encounter of the same package returns the existing Promise
 *     rather than starting a new fetch (handles cycles and diamonds).
 *   - The semaphore is acquired only for the HTTP fetch phase and released before
 *     recursing, preventing deadlock when children also need the semaphore.
 *   - The returned Map uses normalized package names as keys so lookups are
 *     case-insensitive and hyphen/underscore/dot-tolerant.
 *
 * @param {Array<{ name: string, versionSpec: string|null }>} directDeps - parsed direct deps
 * @param {{ onProgress?: (msg: string) => void, downloadStats?: boolean }} [opts]
 * @param {boolean} [opts.downloadStats=false] - when true, fetches monthly download counts
 *   from pypistats.org after the main resolution pass. Defaults to false to avoid
 *   rate-limit errors when many packages are resolved.
 * @returns {Promise<Map<string, { name: string, version: string, releaseDate: string, releaseCount: number, downloadsLastMonth: number|null, error?: string }>>}
 */
async function resolveDependencies(directDeps, opts = {}) {
  const { onProgress, downloadStats = false } = opts;

  /** @type {Map<string, object>} normalized name → resolved result */
  const results = new Map();

  /** @type {Map<string, Promise<void>>} normalized name → in-flight promise (cycle guard) */
  const pending = new Map();

  const semaphore = new Semaphore(CONCURRENCY);

  /**
   * Resolves a single package and recursively enqueues its dependencies.
   * Returns the shared Promise so callers can await the same work without duplicating it.
   * @param {{ name: string, versionSpec: string|null }} dep
   * @returns {Promise<void>}
   */
  function fetchOne(dep) {
    const key = normalizePackageName(dep.name);
    if (pending.has(key)) return pending.get(key);

    const promise = (async () => {
      await semaphore.acquire();

      let packageData;
      try {
        packageData = await fetchPackageInfo(dep.name);
      } finally {
        semaphore.release();
      }

      if (!packageData) {
        onProgress?.(`  [warn] Package not found on PyPI: ${dep.name}`);
        results.set(key, {
          name: dep.name,
          version: 'not found',
          releaseDate: 'unknown',
          firstReleaseDate: 'unknown',
          releaseCount: 0,
          error: 'Package not found on PyPI',
        });
        return;
      }

      const allVersions = getVersionList(packageData);
      const { version } = resolveVersion(dep.versionSpec, allVersions);
      onProgress?.(`  ${packageData.info.name} ${version}`);

      // Use the specific version's requires_dist if it differs from the latest
      let requiresDist = packageData.info.requires_dist ?? [];
      if (version && version !== packageData.info.version) {
        await semaphore.acquire();
        let versionData;
        try {
          versionData = await fetchVersionInfo(dep.name, version);
        } finally {
          semaphore.release();
        }
        if (versionData?.info?.requires_dist) {
          requiresDist = versionData.info.requires_dist;
        }
      }

      const releaseDate = getReleaseDate(packageData, version);
      const firstReleaseDate = getFirstReleaseDate(packageData);
      const releaseCount = getReleaseCount(packageData);
      results.set(key, {
        name: packageData.info.name,
        version,
        releaseDate,
        firstReleaseDate,
        releaseCount,
      });

      // Parse and enqueue transitive dependencies (skip already-pending ones)
      const transitiveDeps = requiresDist
        .map(d => parseRequiresDist(d))
        .filter(Boolean)
        .filter(d => !pending.has(normalizePackageName(d.name)));

      await Promise.all(transitiveDeps.map(d => fetchOne(d)));
    })().catch(err => {
      results.set(key, {
        name: dep.name,
        version: 'error',
        releaseDate: 'unknown',
        firstReleaseDate: 'unknown',
        releaseCount: 0,
        error: err.message,
      });
    });

    pending.set(key, promise);
    return promise;
  }

  await Promise.all(directDeps.map(d => fetchOne(d)));

  // ── Post-resolution pass: fetch download stats from pypistats.org ──────────
  // Only runs when the caller opts in via downloadStats: true.
  // Runs after the BFS so all packages are known upfront and every stats request
  // can fire in parallel without competing with the critical-path resolution work.
  console.log('fetch stats', downloadStats)
  if (downloadStats) {
    onProgress?.('\nFetching download statistics...');
    const statsSemaphore = new Semaphore(CONCURRENCY);

    await Promise.all([...results.values()].map(async (result) => {
      await statsSemaphore.acquire();
      let stats;
      try {
        stats = await fetchDownloadStats(result.name);
      } finally {
        statsSemaphore.release();
      }
      result.downloadsLastMonth = stats?.lastMonth ?? null;
    }));
  } else {
    // Explicitly mark every result so downstream formatters see null rather than undefined.
    for (const result of results.values()) {
      result.downloadsLastMonth = null;
    }
  }
   
  console.log('okay')

  return results;
}

export { resolveDependencies };
