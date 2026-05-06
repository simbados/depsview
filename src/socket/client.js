/**
 * Socket.dev API client.
 * Fetches supply chain security scores for npm and PyPI packages in a single
 * batched POST request using Package URL (PURL) identifiers.
 * API reference: https://docs.socket.dev/reference/batchpackagefetchbyorg
 */

import { fetchWithRetry } from '../util/http.js';

const SOCKET_API = 'https://api.socket.dev/v0/orgs';

/**
 * Builds a Package URL (PURL) string for a given package.
 * @param {string} name       - package name (e.g. "express" or "@esbuild/aix-ppc64")
 * @param {string} version    - exact version string
 * @param {'npm'|'pypi'} ecosystem
 * @returns {string} e.g. "pkg:npm/express@4.19.2" or "pkg:npm/@esbuild/aix-ppc64@0.21.5"
 */
function buildPurl(name, version, ecosystem) {
  return `pkg:${ecosystem}/${name}@${version}`;
}

/**
 * Parses a newline-delimited JSON (NDJSON) string into an array of objects.
 * Each non-empty line is parsed independently; malformed lines are silently
 * skipped rather than aborting the whole parse.
 * @param {string} text - raw NDJSON response body
 * @returns {Array<object>}
 */
function parseNdjson(text) {
  const results = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed));
    } catch {
      // skip unparseable lines
    }
  }
  return results;
}

/**
 * Fetches supply chain security scores for a batch of packages from socket.dev.
 * All packages are sent in a single POST request to stay within API quota.
 * Any failure (network, auth, parse error) returns an empty Map so callers
 * can treat scores as optional enrichment without breaking the main flow.
 *
 * @param {Array<{name: string, version: string}>} packages
 * @param {string} apiKey   - Socket.dev API key (used as HTTP Basic auth username)
 * @param {string} orgSlug  - Socket.dev organisation slug
 * @param {'npm'|'pypi'} ecosystem
 * @returns {Promise<Map<string, number>>} Map of "name@version" → supplyChain score (0–1)
 */
async function fetchSocketScores(packages, apiKey, orgSlug, ecosystem) {
  if (packages.length === 0) return new Map();

  try {
    const components = packages.map(({ name, version }) => ({
      purl: buildPurl(name, version, ecosystem),
    }));

    // compact=false is required — compact mode strips the score field from responses.
    // The API emits one line per release artifact (tar-gz, wheel, …) for the same
    // package version, so we skip any key already written to avoid redundant writes.
    const url =
      `${SOCKET_API}/${encodeURIComponent(orgSlug)}/purl` +
      '?alerts=false&compact=false&fixable=false&licenseattrib=false' +
      '&licensedetails=false&purlErrors=false&poll=false' +
      '&cachedResultsOnly=false&summary=false';

    const text = await fetchWithRetry(url, {
      serviceName:  'socket.dev',
      throwOnError: false,
      method:       'POST',
      headers: {
        'Accept':        'application/x-ndjson',
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body:         JSON.stringify({ components }),
      responseType: 'text',
    });

    if (!text) return new Map();

    const scores = new Map();
    for (const obj of parseNdjson(text)) {
      if (!obj.name || !obj.version || obj.score?.supplyChain == null) continue;
      // For scoped npm packages the API splits the name into `namespace` (@scope)
      // and `name` (bare package name). Recombine them so the key matches the
      // "name@version" format used by the rest of the codebase.
      const fullName = obj.namespace ? `${obj.namespace}/${obj.name}` : obj.name;
      const key = `${fullName.toLowerCase()}@${obj.version}`;
      if (!scores.has(key)) scores.set(key, obj.score.supplyChain);
    }
    return scores;
  } catch {
    return new Map();
  }
}

export { fetchSocketScores, buildPurl, parseNdjson };
