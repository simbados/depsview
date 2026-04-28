/**
 * PyPI JSON API client.
 * Fetches package metadata using the native fetch API (Node ≥18).
 * Maintains an in-memory cache to avoid duplicate requests during a single run.
 * Implements exponential-backoff retry for 429 responses.
 * When debug mode is enabled via src/debug.js, HTTP errors are logged to stderr.
 */

import { debugLog } from './debugging.js';

/** @type {Map<string, object|null>} In-memory cache keyed by "name" or "name@version" */
const cache = new Map();

const PYPI_BASE = 'https://pypi.org/pypi';
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

/**
 * Normalizes a Python package name to its PyPI canonical form:
 * lowercase with all runs of `[-_.]` collapsed to a single `-`.
 * Required so that `Requests`, `requests`, and `requests_` all hit the same cache entry.
 * @param {string} name - raw package name
 * @returns {string} normalized name
 */
function normalizePackageName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * Performs a single fetch with automatic retry on 429 (rate-limit) responses.
 * Waits `RETRY_BASE_MS * 2^attempt` milliseconds before each retry.
 * Throws on network errors and non-retryable HTTP errors after all attempts are exhausted.
 * @param {string} url - full URL to fetch
 * @returns {Promise<object|null>} parsed JSON body, or null on 404
 */
async function fetchWithRetry(url) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let response;
    try {
      response = await fetch(url);
    } catch (networkErr) {
      debugLog(`PyPI network error fetching ${url}: ${networkErr.message}`);
      if (attempt === MAX_RETRIES - 1) throw new Error(`Network error fetching ${url}: ${networkErr.message}`);
      await sleep(RETRY_BASE_MS * 2 ** attempt);
      continue;
    }

    if (response.status === 404) return null;

    if (response.status === 429) {
      // Respect Retry-After header when present, otherwise use exponential backoff
      const retryAfter = response.headers.get('retry-after');
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : RETRY_BASE_MS * 2 ** attempt;
      debugLog(`PyPI rate-limited (429) for ${url}, waiting ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      if (attempt === MAX_RETRIES - 1) throw new Error(`Rate limited by PyPI, giving up after ${MAX_RETRIES} attempts`);
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      debugLog(`PyPI HTTP ${response.status} for ${url}`);
      throw new Error(`PyPI returned HTTP ${response.status} for ${url}`);
    }
    return response.json();
  }
  return null;
}

/**
 * Pauses execution for the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetches the full metadata for a package's latest release from PyPI.
 * The response contains all published version strings, `info.requires_dist` for the
 * latest version, and a `releases` object mapping each version to its upload metadata.
 * Results are cached by normalized package name.
 * @param {string} packageName - package name (case-insensitive)
 * @returns {Promise<object|null>} PyPI package JSON, or null if the package does not exist
 */
async function fetchPackageInfo(packageName) {
  const key = normalizePackageName(packageName);
  if (cache.has(key)) return cache.get(key);

  const data = await fetchWithRetry(`${PYPI_BASE}/${key}/json`);
  cache.set(key, data);
  return data;
}

/**
 * Fetches metadata for a specific version of a package from PyPI.
 * Used to obtain the correct `requires_dist` when the resolved version differs from the latest.
 * Results are cached by "normalizedName@version".
 * @param {string} packageName - package name (case-insensitive)
 * @param {string} version - exact version string, e.g. "2.31.0"
 * @returns {Promise<object|null>} PyPI version JSON, or null if not found
 */
async function fetchVersionInfo(packageName, version) {
  const key = `${normalizePackageName(packageName)}@${version}`;
  if (cache.has(key)) return cache.get(key);

  const data = await fetchWithRetry(`${PYPI_BASE}/${normalizePackageName(packageName)}/${version}/json`);
  cache.set(key, data);
  return data;
}

/**
 * Extracts all published version strings for a package from its PyPI JSON data.
 * Versions whose release file list is empty are excluded (yanked/placeholder entries).
 * @param {object} packageData - PyPI JSON object returned by fetchPackageInfo
 * @returns {string[]} array of version strings
 */
function getVersionList(packageData) {
  if (!packageData?.releases) return [];
  return Object.entries(packageData.releases)
    .filter(([, files]) => Array.isArray(files) && files.length > 0)
    .map(([v]) => v);
}

/**
 * Determines the release date for a specific package version.
 * Takes the earliest `upload_time` among all distribution files (sdist, wheel, etc.)
 * for that version, which represents when the version first became available.
 * @param {object} packageData - PyPI JSON object returned by fetchPackageInfo
 * @param {string} version - exact version string to look up
 * @returns {string} ISO date string like "2023-05-22", or "unknown" if no data exists
 */
function getReleaseDate(packageData, version) {
  const files = packageData?.releases?.[version];
  if (!Array.isArray(files) || files.length === 0) return 'unknown';
  const times = files.map(f => f.upload_time).filter(Boolean).sort();
  return times.length > 0 ? times[0].split('T')[0] : 'unknown';
}

/**
 * Counts the total number of published releases for a package.
 * Only versions that have at least one distribution file are counted;
 * yanked or placeholder entries with an empty file list are excluded.
 * Used as a popularity proxy since PyPI does not expose download counts in its JSON API.
 * @param {object} packageData - PyPI JSON object returned by fetchPackageInfo
 * @returns {number} total number of published versions with at least one file
 */
function getReleaseCount(packageData) {
  if (!packageData?.releases) return 0;
  return Object.values(packageData.releases)
    .filter(files => Array.isArray(files) && files.length > 0)
    .length;
}

/**
 * Determines the date of the very first published release of a package.
 * Flattens all distribution files across every version in the `releases` object,
 * sorts their `upload_time` values ascending, and returns the date portion of the
 * earliest one. This is the package's birthday on PyPI regardless of which version
 * is currently being resolved.
 * @param {object} packageData - PyPI JSON object returned by fetchPackageInfo
 * @returns {string} ISO date string like "2011-02-14", or "unknown" if no data exists
 */
function getFirstReleaseDate(packageData) {
  if (!packageData?.releases) return 'unknown';
  const times = Object.values(packageData.releases)
    .flat()
    .map(f => f.upload_time)
    .filter(Boolean)
    .sort();
  return times.length > 0 ? times[0].split('T')[0] : 'unknown';
}

export { fetchPackageInfo, fetchVersionInfo, getVersionList, getReleaseDate, getReleaseCount, getFirstReleaseDate, normalizePackageName };
