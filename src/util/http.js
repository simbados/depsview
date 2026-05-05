/**
 * Shared HTTP utilities used by all registry API clients.
 * Centralises sleep() and the fetchWithRetry() pattern that was previously
 * duplicated across npmClient.js, pypiClient.js, and pypiStatsClient.js.
 */

import { debugLog } from './debugging.js';

const DEFAULT_MAX_RETRIES  = 3;
const DEFAULT_RETRY_BASE_MS = 1000;

/**
 * Pauses execution for the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetches a URL with automatic exponential-backoff retry on 429 responses.
 *
 * Behaviour on failure:
 *   - 404            → always returns null (resource does not exist)
 *   - network error  → retries up to maxRetries; then throws if throwOnError,
 *                       otherwise returns null
 *   - 429            → retries up to maxRetries honouring Retry-After header;
 *                       then throws if throwOnError, otherwise returns null
 *   - other non-2xx  → immediately throws if throwOnError, otherwise returns null
 *
 * @param {string} url - full URL to fetch
 * @param {object} [opts]
 * @param {string}  [opts.serviceName='HTTP']        - name used in debug/error messages
 * @param {boolean} [opts.throwOnError=true]         - false makes all failures return null
 * @param {number}  [opts.maxRetries=3]              - total attempts (1 = no retries)
 * @param {number}  [opts.retryBaseMs=1000]          - base delay for exponential backoff
 * @param {object}  [opts.headers={}]                - additional request headers
 * @param {string}  [opts.method='GET']              - HTTP method
 * @param {string}  [opts.body]                      - request body (for POST/PUT)
 * @param {'json'|'text'} [opts.responseType='json'] - how to parse a successful response
 * @returns {Promise<object|string|null>} parsed body, or null on 404 / soft failures
 */
async function fetchWithRetry(url, opts = {}) {
  const {
    serviceName  = 'HTTP',
    throwOnError = true,
    maxRetries   = DEFAULT_MAX_RETRIES,
    retryBaseMs  = DEFAULT_RETRY_BASE_MS,
    headers      = {},
    method       = 'GET',
    body,
    responseType = 'json',
  } = opts;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let response;
    try {
      response = await fetch(url, { method, headers, body });
    } catch (networkErr) {
      debugLog(`${serviceName} network error fetching ${url}: ${networkErr.message}`);
      if (attempt === maxRetries - 1) {
        if (throwOnError) throw new Error(`Network error fetching ${url}: ${networkErr.message}`);
        return null;
      }
      await sleep(retryBaseMs * 2 ** attempt);
      continue;
    }

    if (response.status === 404) return null;

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : retryBaseMs * 2 ** attempt;
      debugLog(`${serviceName} rate-limited (429) for ${url}, waiting ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      if (attempt === maxRetries - 1) {
        if (throwOnError) throw new Error(`Rate limited by ${serviceName} after ${maxRetries} attempts`);
        return null;
      }
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      debugLog(`${serviceName} HTTP ${response.status} for ${url}`);
      if (throwOnError) throw new Error(`${serviceName} returned HTTP ${response.status} for ${url}`);
      return null;
    }

    return responseType === 'text' ? response.text() : response.json();
  }
  return null;
}

export { sleep, fetchWithRetry };
