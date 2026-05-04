/**
 * pypistats.org API client.
 * Fetches recent download statistics for Python packages.
 * Uses the native fetch API (Node ≥18) and maintains an in-memory cache.
 * All failures (404, network errors, unexpected shapes) return null so that
 * missing stats never crash or block the main dependency output.
 * When debug mode is enabled via src/debug.js, HTTP errors are logged to stderr.
 */

import { fetchWithRetry } from '../util/http.js';
import { normalizePackageName } from './pypiClient.js';
import { debugLog } from '../util/debugging.js';

/** @type {Map<string, { lastMonth: number }|null>} cache keyed by normalized package name */
const cache = new Map();

const STATS_BASE = 'https://pypistats.org/api/packages';

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

  const data = await fetchWithRetry(`${STATS_BASE}/${key}/recent`, { serviceName: 'pypistats', throwOnError: false });
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
