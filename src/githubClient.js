/**
 * GitHub Contents API client.
 * Wraps the two endpoints needed to discover and fetch dependency files
 * from a GitHub repository without cloning it locally.
 *
 * Authentication: set the GITHUB_TOKEN environment variable to a personal
 * access token to raise the rate limit from 60 to 5000 requests/hour and to
 * access private repositories.
 *
 * When debug mode is active (src/debugging.js), API errors are logged to stderr.
 */

import { debugLog } from './debugging.js';

const GITHUB_API = 'https://api.github.com';

/**
 * Builds the HTTP headers for every GitHub API request.
 * Includes the recommended Accept and API-version headers and, when the
 * GITHUB_TOKEN environment variable is set, a Bearer token for authentication.
 * @returns {Record<string, string>}
 */
function buildHeaders() {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'depsview',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

/**
 * Lists the contents of a directory in a GitHub repository using the Contents API.
 * Returns an array of entry objects (each with `name`, `type`, and `path` fields)
 * or null when the path does not exist in the repository.
 * Throws when the API returns an unexpected error status.
 * @param {string} owner   - GitHub user or organisation name
 * @param {string} repo    - repository name
 * @param {string} dirPath - path within the repository (empty string for root)
 * @param {string} ref     - branch, tag, or commit SHA
 * @returns {Promise<Array<{ name: string, type: string, path: string }>|null>}
 */
async function listDirectory(owner, repo, dirPath, ref) {
  const apiPath = dirPath ? `/${dirPath}` : '';
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents${apiPath}?ref=${encodeURIComponent(ref)}`;

  let response;
  try {
    response = await fetch(url, { headers: buildHeaders() });
  } catch (networkErr) {
    debugLog(`GitHub network error listing ${url}: ${networkErr.message}`);
    throw new Error(`Network error reaching GitHub API: ${networkErr.message}`);
  }

  if (response.status === 404) {
    debugLog(`GitHub 404 listing directory: ${url}`);
    return null;
  }
  if (response.status === 403 || response.status === 401) {
    const msg = response.status === 401
      ? 'Unauthorized — set GITHUB_TOKEN for private repos'
      : 'Forbidden — rate limit may be exceeded; set GITHUB_TOKEN to increase it';
    debugLog(`GitHub ${response.status} for ${url}: ${msg}`);
    throw new Error(`GitHub API: ${msg}`);
  }
  if (!response.ok) {
    debugLog(`GitHub HTTP ${response.status} for ${url}`);
    throw new Error(`GitHub API returned HTTP ${response.status} for ${url}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    // The path resolved to a file, not a directory
    debugLog(`GitHub: expected directory listing but got a file object at ${url}`);
    return null;
  }
  return data;
}

/**
 * Fetches and decodes the text content of a single file from a GitHub repository.
 * The Contents API returns file content as base64; this function decodes it to a
 * UTF-8 string. Returns null when the file does not exist or cannot be decoded.
 * Throws when the API returns an unexpected error status.
 * @param {string} owner    - GitHub user or organisation name
 * @param {string} repo     - repository name
 * @param {string} filePath - path to the file within the repository
 * @param {string} ref      - branch, tag, or commit SHA
 * @returns {Promise<string|null>} decoded file content, or null if not found
 */
async function fetchFileContent(owner, repo, filePath, ref) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`;

  let response;
  try {
    response = await fetch(url, { headers: buildHeaders() });
  } catch (networkErr) {
    debugLog(`GitHub network error fetching ${url}: ${networkErr.message}`);
    throw new Error(`Network error reaching GitHub API: ${networkErr.message}`);
  }

  if (response.status === 404) {
    debugLog(`GitHub 404 fetching file: ${url}`);
    return null;
  }
  if (response.status === 403 || response.status === 401) {
    const msg = response.status === 401
      ? 'Unauthorized — set GITHUB_TOKEN for private repos'
      : 'Forbidden — rate limit may be exceeded; set GITHUB_TOKEN to increase it';
    debugLog(`GitHub ${response.status} for ${url}: ${msg}`);
    throw new Error(`GitHub API: ${msg}`);
  }
  if (!response.ok) {
    debugLog(`GitHub HTTP ${response.status} for ${url}`);
    throw new Error(`GitHub API returned HTTP ${response.status} for ${url}`);
  }

  const data = await response.json();
  if (!data.content || data.encoding !== 'base64') {
    debugLog(`GitHub: unexpected response shape for ${url} (encoding=${data.encoding})`);
    return null;
  }

  return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
}

export { listDirectory, fetchFileContent };
