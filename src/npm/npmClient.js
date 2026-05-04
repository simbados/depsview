/**
 * npm registry API client.
 * Uses the public registry at https://registry.npmjs.org.
 * Maintains an in-memory cache to avoid duplicate requests within one run.
 * Implements exponential-backoff retry for 429 responses.
 */

import { fetchWithRetry } from '../util/http.js';

const REGISTRY = 'https://registry.npmjs.org';

/** @type {Map<string, object|null>} */
const cache = new Map();

/**
 * Encodes a package name for use as a registry URL segment.
 * Scoped packages (@scope/name) have their slash encoded as %2F so the URL
 * is unambiguous: https://registry.npmjs.org/@scope%2Fname
 * @param {string} name
 * @returns {string}
 */
function encodePackageName(name) {
  return name.startsWith('@') ? name.replace('/', '%2F') : name;
}

/**
 * Fetches the full package document from the npm registry.
 * The document contains all versions, dist-tags, and a `time` object mapping
 * every version string to its ISO publish timestamp.
 * Results are cached by lowercased package name.
 * @param {string} name - package name (scoped or plain)
 * @returns {Promise<object|null>} registry document, or null if not found
 */
async function fetchPackageInfo(name) {
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const data = await fetchWithRetry(`${REGISTRY}/${encodePackageName(name)}`, { serviceName: 'npm registry' });
  cache.set(key, data);
  return data;
}

/**
 * Returns all published version strings for a package.
 * @param {object} packageData - npm registry package document
 * @returns {string[]}
 */
function getVersionList(packageData) {
  return Object.keys(packageData?.versions ?? {});
}

/**
 * Returns the publish date for a specific version as "YYYY-MM-DD".
 * Uses the `time` object in the registry document.
 * @param {object} packageData
 * @param {string} version
 * @returns {string} ISO date string or "unknown"
 */
function getReleaseDate(packageData, version) {
  const ts = packageData?.time?.[version];
  return ts ? ts.split('T')[0] : 'unknown';
}

/**
 * Returns the date the package was first published as "YYYY-MM-DD".
 * Prefers `time.created`; falls back to the earliest version timestamp.
 * @param {object} packageData
 * @returns {string} ISO date string or "unknown"
 */
function getFirstReleaseDate(packageData) {
  const time = packageData?.time;
  if (!time) return 'unknown';
  if (time.created) return time.created.split('T')[0];
  const times = Object.entries(time)
    .filter(([k]) => k !== 'modified' && k !== 'created')
    .map(([, v]) => v)
    .filter(Boolean)
    .sort();
  return times.length > 0 ? times[0].split('T')[0] : 'unknown';
}

/**
 * Returns the total number of published versions for a package.
 * @param {object} packageData
 * @returns {number}
 */
function getReleaseCount(packageData) {
  return Object.keys(packageData?.versions ?? {}).length;
}

/**
 * Clears the in-memory cache. For use in tests only.
 */
function _clearCache() {
  cache.clear();
}

export { fetchPackageInfo, getVersionList, getReleaseDate, getFirstReleaseDate, getReleaseCount, _clearCache };
