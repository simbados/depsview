/**
 * pypistats.org API client.
 * Fetches recent download statistics for Python packages.
 * Uses the native fetch API (Node ≥18) and maintains an in-memory cache.
 * All failures (404, network errors, unexpected shapes) return null so that
 * missing stats never crash or block the main dependency output.
 * When debug mode is enabled via src/debug.js, HTTP errors are logged to stderr.
 */

import { debugLog } from './debugging.js';

/** @type {Map<string, { lastMonth: number }|null>} cache keyed by normalized package name */
const cache = new Map();

const STATS_BASE = 'https://pypistats.org/api/packages';
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

/**
 * Normalizes a Python package name for use as a cache key and URL segment.
 * Lowercases the name and collapses any run of [-_.] to a single hyphen,
 * matching PyPI's own canonical normalization rules.
 * @param {string} name - raw package name
 * @returns {string} normalized name
 */
function normalizePackageName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
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
 * Fetches a URL with automatic retry on 429 (rate-limit) responses.
 * Unlike pypiClient, all non-success responses return null rather than throwing,
 * because download statistics are supplementary and must not block the main output.
 * @param {string} url - full URL to fetch
 * @returns {Promise<object|null>} parsed JSON body, or null on any failure
 */
async function fetchWithRetry(url) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let response;
    try {
      response = await fetch(url);
    } catch (networkErr) {
      debugLog(`pypistats network error fetching ${url}: ${networkErr.message}`);
      if (attempt === MAX_RETRIES - 1) return null;
      await sleep(RETRY_BASE_MS * 2 ** attempt);
      continue;
    }

    if (response.status === 404) {
      debugLog(`pypistats 404 for ${url}`);
      return null;
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : RETRY_BASE_MS * 2 ** attempt;
      debugLog(`pypistats rate-limited (429) for ${url}, waiting ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      if (attempt === MAX_RETRIES - 1) return null;
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      debugLog(`pypistats HTTP ${response.status} for ${url}`);
      return null;
    }
    return response.json();
  }
  return null;
}

/**
 * Fetches recent download statistics for a package from pypistats.org.
 * Calls GET /api/packages/{name}/recent which returns last-day, last-week,
 * and last-month download counts. Only last_month is exposed in the return value
 * as it is the most stable and meaningful signal for popularity.
 * Results are cached by normalized name so repeated lookups within one run
 * do not produce duplicate HTTP requests.
 * @param {string} packageName - package name (case-insensitive)
 * @returns {Promise<{ lastMonth: number }|null>} download stats, or null if unavailable
 */
async function fetchDownloadStats(packageName) {
  const key = normalizePackageName(packageName);
  if (cache.has(key)) return cache.get(key);

  const data = await fetchWithRetry(`${STATS_BASE}/${key}/recent`);
  const result = (data?.data?.last_month != null)
    ? { lastMonth: data.data.last_month }
    : null;
  if (data !== null && result === null) {
    debugLog(`pypistats: no last_month field in response for ${key}: ${JSON.stringify(data)}`);
  }

  cache.set(key, result);
  return result;
}

/**
 * Clears the in-memory cache. Intended for use in tests only so that each
 * test starts from a clean state and cache hits do not mask fetch behaviour.
 */
function _clearCache() {
  cache.clear();
}

export { fetchDownloadStats, _clearCache };
