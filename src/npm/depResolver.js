/**
 * npm dependency resolver — two resolution paths in one interface.
 *
 * Lock file path  (input items have a `version` property):
 *   All packages are already resolved. Fetch registry metadata in parallel
 *   for release dates and counts; no recursive traversal needed.
 *
 * package.json path  (input items have a `versionSpec` property):
 *   Recursively resolve transitive dependencies by fetching each package's
 *   registry document, resolving the best semver match, then enqueuing the
 *   resolved version's own `dependencies`. Same semaphore + pending-map
 *   algorithm as python/depResolver.js for cycle detection and concurrency.
 */

import { fetchPackageInfo, getVersionList, getReleaseDate, getFirstReleaseDate, getReleaseCount } from './npmClient.js';
import { resolveVersion } from './versionResolver.js';
import { isNonRegistrySpec } from './parserCore.js';
import { Semaphore } from '../util/semaphore.js';

const CONCURRENCY = 10;

/**
 * Normalizes an npm package name for use as a Map key.
 * npm package names are lowercase by convention; we lowercase defensively.
 * @param {string} name
 * @returns {string}
 */
function normalizePackageName(name) {
  return name.toLowerCase();
}

/**
 * Builds the registry result object stored in the results Map.
 * @param {object} packageData - npm registry document
 * @param {string} fallbackName - name to use when packageData.name is absent
 * @param {string} version
 * @returns {object}
 */
function buildResult(packageData, fallbackName, version) {
  const name = packageData?.name ?? fallbackName;
  return {
    name,
    version,
    releaseDate:      getReleaseDate(packageData, version),
    firstReleaseDate: getFirstReleaseDate(packageData),
    releaseCount:     getReleaseCount(packageData),
    downloadsLastMonth: null,
    link: `https://www.npmjs.com/package/${name}`,
  };
}

/**
 * Lock file path: all packages are already known with exact versions.
 * Fires all registry metadata fetches in parallel (bounded by semaphore).
 * @param {Array<{ name: string, version: string }>} packages
 * @param {{ onProgress?: (msg: string) => void }} opts
 * @returns {Promise<Map<string, object>>}
 */
async function resolveFromLock(packages, opts) {
  const { onProgress } = opts;
  const results   = new Map();
  const semaphore = new Semaphore(CONCURRENCY);

  await Promise.all(packages.map(async ({ name, version }) => {
    // Key includes version so multiple installed versions of the same package
    // each get their own entry in the results Map.
    const key = `${normalizePackageName(name)}@${version}`;
    try {
      await semaphore.acquire();
      let packageData;
      try {
        packageData = await fetchPackageInfo(name);
      } finally {
        semaphore.release();
      }

      if (!packageData) {
        onProgress?.(`  [warn] Package not found on npm registry: ${name}`);
        results.set(key, {
          name, version,
          releaseDate: 'unknown', firstReleaseDate: 'unknown',
          releaseCount: 0, downloadsLastMonth: null,
          link: `https://www.npmjs.com/package/${name}`,
          error: 'Package not found on npm registry',
        });
        return;
      }

      onProgress?.(`  ${packageData.name ?? name} ${version}`);
      results.set(key, buildResult(packageData, name, version));
    } catch (err) {
      // A network error on one package must not abort the entire batch —
      // store it as an error entry and continue resolving the rest.
      results.set(key, {
        name, version,
        releaseDate: 'unknown', firstReleaseDate: 'unknown',
        releaseCount: 0, downloadsLastMonth: null,
        link: `https://www.npmjs.com/package/${name}`,
        error: err.message,
      });
    }
  }));

  return results;
}

/**
 * package.json fallback path: recursively resolves transitive deps via the registry.
 * Uses a pending Map to detect cycles and avoid duplicate fetches.
 * @param {Array<{ name: string, versionSpec: string|null }>} directDeps
 * @param {{ onProgress?: (msg: string) => void }} opts
 * @returns {Promise<Map<string, object>>}
 */
async function resolveFromRanges(directDeps, opts) {
  const { onProgress } = opts;
  const results   = new Map();
  const pending   = new Map();
  const semaphore = new Semaphore(CONCURRENCY);

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
        onProgress?.(`  [warn] Package not found on npm registry: ${dep.name}`);
        results.set(key, {
          name: dep.name, version: 'not found',
          releaseDate: 'unknown', firstReleaseDate: 'unknown',
          releaseCount: 0, downloadsLastMonth: null,
          link: `https://www.npmjs.com/package/${dep.name}`,
          error: 'Package not found on npm registry',
        });
        return;
      }

      const allVersions = getVersionList(packageData);
      const { version } = resolveVersion(dep.versionSpec, allVersions);
      onProgress?.(`  ${packageData.name ?? dep.name} ${version}`);
      results.set(key, buildResult(packageData, dep.name, version));

      // Enqueue transitive deps from the resolved version's registry manifest.
      // Skip entries already in flight and non-registry specs.
      const versionDeps = packageData.versions?.[version]?.dependencies ?? {};
      const transitive = Object.entries(versionDeps)
        .filter(([n, s]) => !pending.has(normalizePackageName(n)) && !isNonRegistrySpec(s))
        .map(([n, s]) => ({ name: n, versionSpec: s }));

      await Promise.all(transitive.map(d => fetchOne(d)));
    })().catch(err => {
      results.set(key, {
        name: dep.name, version: 'error',
        releaseDate: 'unknown', firstReleaseDate: 'unknown',
        releaseCount: 0, downloadsLastMonth: null,
        link: `https://www.npmjs.com/package/${dep.name}`,
        error: err.message,
      });
    });

    pending.set(key, promise);
    return promise;
  }

  await Promise.all(directDeps.map(d => fetchOne(d)));
  return results;
}

/**
 * Resolves npm dependencies and returns registry metadata for each package.
 * Automatically selects the resolution path based on the input shape:
 *   - Items with a `version` property  → lock file path (metadata-only)
 *   - Items with a `versionSpec` property → package.json path (recursive)
 * @param {Array<{ name: string, version: string }|{ name: string, versionSpec: string|null }>} deps
 * @param {{ onProgress?: (msg: string) => void }} [opts]
 * @returns {Promise<Map<string, object>>}
 */
async function resolveDependencies(deps, opts = {}) {
  if (deps.length === 0) return new Map();
  return 'version' in deps[0]
    ? resolveFromLock(deps, opts)
    : resolveFromRanges(deps, opts);
}

export { resolveDependencies, normalizePackageName };
