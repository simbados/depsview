/**
 * PEP 440 version resolution for Python packages.
 * Parses version strings into comparable structs and evaluates version specifiers.
 */

/**
 * Parses a PEP 440 version string into a structured object suitable for comparison.
 * Handles epoch, release segments, pre-release (a/b/rc), post-release, and dev releases.
 * @param {string} vStr - raw version string, e.g. "1.2.3", "2.0a1", "1.0.post1", "1.0.dev0"
 * @returns {{ epoch: number, release: number[], pre: [number,number]|null, post: number|null, dev: number|null }}
 */
function parseVersion(vStr) {
  let v = String(vStr).toLowerCase().trim().replace(/^v/, '');
  v = v.split('+')[0]; // strip local version identifier

  let epoch = 0;
  const epochMatch = v.match(/^(\d+)!/);
  if (epochMatch) {
    epoch = parseInt(epochMatch[1], 10);
    v = v.slice(epochMatch[0].length);
  }

  let dev = null;
  const devMatch = v.match(/[._-]?dev(\d*)$/);
  if (devMatch) {
    dev = parseInt(devMatch[1] || '0', 10);
    v = v.slice(0, v.length - devMatch[0].length);
  }

  let post = null;
  const postMatch = v.match(/[._-]?post\.?(\d+)$/i) || v.match(/-(\d+)$/);
  if (postMatch) {
    post = parseInt(postMatch[1], 10);
    v = v.slice(0, v.length - postMatch[0].length);
  }

  let pre = null;
  const preMatch = v.match(/[._-]?(a|alpha|b|beta|c|rc|preview)\.?(\d*)$/i);
  if (preMatch) {
    const kind = preMatch[1].toLowerCase();
    const num = parseInt(preMatch[2] || '0', 10);
    // a/alpha=0, b/beta=1, c/rc/preview=2
    const typeNum = (kind === 'a' || kind === 'alpha') ? 0 : (kind === 'b' || kind === 'beta') ? 1 : 2;
    pre = [typeNum, num];
    v = v.slice(0, v.length - preMatch[0].length);
  }

  const release = v.split('.').map(p => parseInt(p, 10) || 0).filter((_, i) => i < 10);
  if (release.length === 0) release.push(0);

  return { epoch, release, pre, post, dev };
}

/**
 * Compares two parsed version objects following PEP 440 ordering rules.
 * Pre-releases sort below their release; dev releases sort below pre-releases.
 * @param {ReturnType<parseVersion>} a
 * @param {ReturnType<parseVersion>} b
 * @returns {number} negative if a < b, 0 if equal, positive if a > b
 */
function compareVersions(a, b) {
  if (a.epoch !== b.epoch) return a.epoch - b.epoch;

  const maxLen = Math.max(a.release.length, b.release.length);
  for (let i = 0; i < maxLen; i++) {
    const av = a.release[i] ?? 0;
    const bv = b.release[i] ?? 0;
    if (av !== bv) return av - bv;
  }

  // pre-release is less than a release: 1.0a1 < 1.0
  const aHasPre = a.pre !== null;
  const bHasPre = b.pre !== null;
  if (aHasPre !== bHasPre) return aHasPre ? -1 : 1;
  if (aHasPre && bHasPre) {
    if (a.pre[0] !== b.pre[0]) return a.pre[0] - b.pre[0];
    if (a.pre[1] !== b.pre[1]) return a.pre[1] - b.pre[1];
  }

  // post release is greater: 1.0.post1 > 1.0
  const aPost = a.post ?? -1;
  const bPost = b.post ?? -1;
  if (aPost !== bPost) return aPost - bPost;

  // dev release is less: 1.0.dev0 < 1.0
  // null (no dev) → treat as Infinity so it sorts above dev releases
  const aDev = a.dev ?? Infinity;
  const bDev = b.dev ?? Infinity;
  if (aDev !== bDev) return aDev === Infinity ? 1 : bDev === Infinity ? -1 : aDev - bDev;

  return 0;
}

/**
 * Returns true if a parsed version is a pre-release or dev release.
 * @param {ReturnType<parseVersion>} parsed
 * @returns {boolean}
 */
function isParsedPreRelease(parsed) {
  return parsed.pre !== null || parsed.dev !== null;
}

/**
 * Returns true if a raw version string represents a pre-release or dev release.
 * @param {string} vStr
 * @returns {boolean}
 */
function isPreRelease(vStr) {
  try {
    return isParsedPreRelease(parseVersion(vStr));
  } catch {
    return false;
  }
}

/**
 * Tests whether a single version string satisfies one operator + constraint pair.
 * Handles PEP 440 operators including wildcard `==X.Y.*` and compatible release `~=X.Y`.
 * @param {string} versionStr - candidate version, e.g. "2.31.0"
 * @param {string} operator - one of ==, !=, >=, <=, >, <, ~=
 * @param {string} constraintStr - constraint version, e.g. "2.0" or "1.4.*"
 * @returns {boolean}
 */
function satisfiesConstraint(versionStr, operator, constraintStr) {
  // Wildcard equality / inequality: ==1.0.* or !=1.0.*
  if (constraintStr.endsWith('.*')) {
    const prefix = constraintStr.slice(0, -2);
    const prefixParts = prefix.split('.');
    const vParts = versionStr.split('.');
    const matches = prefixParts.every((p, i) => (vParts[i] ?? '').split(/[a-zA-Z]/)[0] === p);
    return operator === '!=' ? !matches : matches;
  }

  let v, c;
  try {
    v = parseVersion(versionStr);
    c = parseVersion(constraintStr);
  } catch {
    return false;
  }

  const cmp = compareVersions(v, c);

  switch (operator) {
    case '==': return cmp === 0;
    case '!=': return cmp !== 0;
    case '>=': return cmp >= 0;
    case '<=': return cmp <= 0;
    case '>':  return cmp > 0;
    case '<':  return cmp < 0;
    case '~=': {
      // Lower bound: version >= constraint
      if (cmp < 0) return false;
      // Upper bound: increment the second-to-last release segment of the constraint
      const upper = [...c.release];
      upper.pop(); // drop the last segment
      if (upper.length === 0) return true; // degenerate single-segment ~=X
      upper[upper.length - 1]++;
      const upperParsed = { epoch: c.epoch, release: upper, pre: null, post: null, dev: null };
      return compareVersions(v, upperParsed) < 0;
    }
    default:
      return true;
  }
}

/**
 * Parses a PEP 440 version specifier string into an array of [operator, constraintStr] pairs.
 * Handles comma-separated multiple constraints, e.g. ">=2.0,<3.0,!=2.5".
 * @param {string|null} spec - version specifier string, or null/empty for "any version"
 * @returns {Array<[string, string]>} list of [operator, constraintVersion] tuples
 */
function parseVersionSpec(spec) {
  if (!spec || spec.trim() === '' || spec.trim() === '*') return [];
  return spec.split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const m = s.match(/^(==|!=|>=|<=|~=|>|<)\s*(.+)$/);
      return m ? [m[1], m[2].trim()] : null;
    })
    .filter(Boolean);
}

/**
 * Resolves the best matching version from a list of all available versions given a version spec.
 * Prefers stable (non-pre-release) versions unless the spec explicitly requires a pre-release.
 * Falls back to the absolute latest if no version satisfies the constraints.
 * @param {string|null} versionSpec - PEP 440 version specifier string, e.g. ">=2.0,<3.0"
 * @param {string[]} allVersions - all published versions from PyPI (unsorted)
 * @returns {{ version: string, isLatest: boolean }}
 */
function resolveVersion(versionSpec, allVersions) {
  if (!allVersions || allVersions.length === 0) {
    return { version: 'unknown', isLatest: true };
  }

  /** @param {string[]} versions */
  const sortedDesc = (versions) =>
    [...versions].sort((a, b) => {
      try { return compareVersions(parseVersion(b), parseVersion(a)); }
      catch { return 0; }
    });

  const constraints = parseVersionSpec(versionSpec);

  const stableVersions = allVersions.filter(v => !isPreRelease(v));
  const candidatePool = stableVersions.length > 0 ? stableVersions : allVersions;
  const sorted = sortedDesc(candidatePool);

  if (constraints.length === 0) {
    return { version: sorted[0], isLatest: true };
  }

  const satisfies = (v) => constraints.every(([op, c]) => satisfiesConstraint(v, op, c));

  for (const v of sorted) {
    if (satisfies(v)) return { version: v, isLatest: v === sorted[0] };
  }

  // Retry including pre-releases
  const allSorted = sortedDesc(allVersions);
  for (const v of allSorted) {
    if (satisfies(v)) return { version: v, isLatest: v === allSorted[0] };
  }

  // No match — return latest as fallback
  return { version: sorted[0] ?? allVersions[0], isLatest: true };
}

export { parseVersion, compareVersions, resolveVersion, parseVersionSpec, isPreRelease };
