/**
 * GitHub URL parser.
 * Extracts owner, repo, git ref, and subfolder path from GitHub repository URLs.
 * Supports plain repo URLs and /tree/ref[/subpath] variants.
 */

/**
 * Returns true when the given string looks like a GitHub repository URL.
 * Only checks the scheme and host; does not validate that owner/repo exist.
 * @param {string} s - string to test
 * @returns {boolean}
 */
function isGithubUrl(s) {
  return typeof s === 'string' && /^https?:\/\/github\.com\//i.test(s);
}

/**
 * Parses a GitHub URL into its structural components.
 *
 * Handles these URL shapes:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/main
 *   https://github.com/owner/repo/tree/main/some/subfolder
 *
 * When a /tree/ segment is present the first path component after it is treated
 * as the ref (branch, tag, or commit SHA) and the remainder is the subpath.
 * Branch names that themselves contain slashes (e.g. feature/my-branch) are not
 * supported — only the first segment is used as the ref.
 *
 * @param {string} url - GitHub URL to parse
 * @returns {{ owner: string, repo: string, ref: string, subpath: string }}
 * @throws {Error} if the URL does not match the expected GitHub URL shape
 */
function parseGithubUrl(url) {
  const clean = url.trim().replace(/\/+$/, '');

  const match = clean.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/(.+))?$/i
  );

  if (!match) {
    throw new Error(`Not a valid GitHub repository URL: ${url}`);
  }

  const owner   = match[1];
  const repo    = match[2];
  const treePart = match[3] ?? '';

  let ref     = 'HEAD';
  let subpath = '';

  if (treePart) {
    const slashIdx = treePart.indexOf('/');
    if (slashIdx === -1) {
      ref = treePart;
    } else {
      ref     = treePart.slice(0, slashIdx);
      subpath = treePart.slice(slashIdx + 1);
    }
  }

  return { owner, repo, ref, subpath };
}

export { isGithubUrl, parseGithubUrl };
