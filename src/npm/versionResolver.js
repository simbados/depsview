/**
 * Semver version resolution for npm packages.
 * Implements the semver 2.0 specification and the npm range syntax
 * (^, ~, x-ranges, comparator sets, || unions).
 */

/**
 * Parses a semver version string into a comparable struct.
 * Handles an optional leading "v", pre-release identifiers, and build metadata.
 * @param {string} v
 * @returns {{ major: number, minor: number, patch: number, pre: Array<number|string>|null }}
 */
function parseSemver(v) {
  const s = String(v).trim().replace(/^v/, '').split('+')[0];
  const dashIdx = s.indexOf('-');
  const core   = dashIdx === -1 ? s : s.slice(0, dashIdx);
  const preStr = dashIdx === -1 ? null : s.slice(dashIdx + 1);

  const parts = core.split('.');
  const major = parseInt(parts[0], 10) || 0;
  const minor = parseInt(parts[1], 10) || 0;
  const patch = parseInt(parts[2], 10) || 0;

  const pre = preStr
    ? preStr.split('.').map(p => /^\d+$/.test(p) ? parseInt(p, 10) : p)
    : null;

  return { major, minor, patch, pre };
}

/**
 * Compares two parsed semver objects.
 * Returns negative when a < b, 0 when equal, positive when a > b.
 * Pre-release versions sort below the corresponding release (1.0.0-alpha < 1.0.0).
 * Among pre-release identifiers, numeric parts compare numerically and string
 * parts compare lexically; numeric < string per semver spec.
 * @param {ReturnType<parseSemver>} a
 * @param {ReturnType<parseSemver>} b
 * @returns {number}
 */
function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  // null pre (release) > non-null pre (pre-release)
  if (a.pre === null && b.pre !== null) return 1;
  if (a.pre !== null && b.pre === null) return -1;
  if (a.pre !== null && b.pre !== null) {
    const len = Math.max(a.pre.length, b.pre.length);
    for (let i = 0; i < len; i++) {
      if (i >= a.pre.length) return -1;
      if (i >= b.pre.length) return 1;
      const ai = a.pre[i], bi = b.pre[i];
      const aNum = typeof ai === 'number', bNum = typeof bi === 'number';
      if (aNum && bNum) { if (ai !== bi) return ai - bi; continue; }
      if (aNum) return -1; // numeric < string in semver pre-release ordering
      if (bNum) return 1;
      const cmp = String(ai).localeCompare(String(bi));
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

/**
 * Returns true when a version string has a pre-release identifier.
 * @param {string} v
 * @returns {boolean}
 */
function isPreRelease(v) {
  try { return parseSemver(v).pre !== null; }
  catch { return false; }
}

// ── Range expansion ───────────────────────────────────────────────────────────

/**
 * Expands a tilde range (~X.Y.Z) into [>= lower, < upper] comparators.
 * ~1.2.3 → >=1.2.3 <1.3.0
 * ~1.2   → >=1.2.0 <1.3.0
 * ~1     → >=1.0.0 <2.0.0
 * @param {string} s - version string after the ~
 * @returns {Array<{ op: string, ver: ReturnType<parseSemver> }>}
 */
function expandTilde(s) {
  const parts = s.split('.');
  const major = parseInt(parts[0], 10) || 0;
  const hasMinor = parts.length >= 2 && !/^[xX*]$/.test(parts[1]);
  const minor = hasMinor ? (parseInt(parts[1], 10) || 0) : 0;
  const patch = parts.length >= 3 && !/^[xX*]$/.test(parts[2]) ? (parseInt(parts[2], 10) || 0) : 0;

  const lower = parseSemver(`${major}.${minor}.${patch}`);
  const upper = hasMinor
    ? parseSemver(`${major}.${minor + 1}.0`)
    : parseSemver(`${major + 1}.0.0`);

  return [{ op: '>=', ver: lower }, { op: '<', ver: upper }];
}

/**
 * Expands a caret range (^X.Y.Z) into [>= lower, < upper] comparators.
 * The upper bound is set by incrementing the leftmost non-zero component.
 * ^1.2.3 → >=1.2.3 <2.0.0
 * ^0.2.3 → >=0.2.3 <0.3.0
 * ^0.0.3 → >=0.0.3 <0.0.4
 * ^1.2   → >=1.2.0 <2.0.0
 * ^0.0   → >=0.0.0 <0.1.0
 * ^0     → >=0.0.0 <1.0.0
 * @param {string} s - version string after the ^
 * @returns {Array<{ op: string, ver: ReturnType<parseSemver> }>}
 */
function expandCaret(s) {
  const parts = s.split('.');
  const isWild = p => !p || /^[xX*]$/.test(p);

  const major = parseInt(parts[0], 10) || 0;
  const minor = parts.length >= 2 && !isWild(parts[1]) ? parseInt(parts[1], 10) || 0 : null;
  const patch = parts.length >= 3 && !isWild(parts[2]) ? parseInt(parts[2], 10) || 0 : null;

  const lower = parseSemver(`${major}.${minor ?? 0}.${patch ?? 0}`);

  let upper;
  if (major > 0) {
    upper = parseSemver(`${major + 1}.0.0`);
  } else if (minor === null) {
    upper = parseSemver('1.0.0');
  } else if (minor > 0) {
    upper = parseSemver(`0.${minor + 1}.0`);
  } else if (patch === null) {
    upper = parseSemver('0.1.0');
  } else if (patch > 0) {
    upper = parseSemver(`0.0.${patch + 1}`);
  } else {
    upper = parseSemver('0.0.1');
  }

  return [{ op: '>=', ver: lower }, { op: '<', ver: upper }];
}

/**
 * Expands an X-range (1.x, 1.2.*, *) into comparator objects.
 * 1.x   → >=1.0.0 <2.0.0
 * 1.2.x → >=1.2.0 <1.3.0
 * *     → [] (any version — no constraints)
 * @param {string} s
 * @returns {Array<{ op: string, ver: ReturnType<parseSemver> }>}
 */
function expandXRange(s) {
  const parts = s.split('.');
  const isWild = p => !p || /^[xX*]$/.test(p);

  if (isWild(parts[0])) return [];

  const major = parseInt(parts[0], 10);

  if (parts.length < 2 || isWild(parts[1])) {
    return [
      { op: '>=', ver: parseSemver(`${major}.0.0`) },
      { op: '<',  ver: parseSemver(`${major + 1}.0.0`) },
    ];
  }

  const minor = parseInt(parts[1], 10);

  if (parts.length < 3 || isWild(parts[2])) {
    return [
      { op: '>=', ver: parseSemver(`${major}.${minor}.0`) },
      { op: '<',  ver: parseSemver(`${major}.${minor + 1}.0`) },
    ];
  }

  return [{ op: '=', ver: parseSemver(s) }];
}

/**
 * Tests whether a parsed version satisfies one comparator.
 * @param {ReturnType<parseSemver>} v
 * @param {{ op: string, ver: ReturnType<parseSemver> }} comparator
 * @returns {boolean}
 */
function satisfiesComparator(v, { op, ver }) {
  const cmp = compareSemver(v, ver);
  switch (op) {
    case '=':
    case '==': return cmp === 0;
    case '>=': return cmp >= 0;
    case '<=': return cmp <= 0;
    case '>':  return cmp > 0;
    case '<':  return cmp < 0;
    default:   return true;
  }
}

/**
 * Parses a single whitespace-free token (no || or spaces) into comparator objects.
 * Handles ~, ^, X-ranges, explicit operator comparators, and bare exact versions.
 * @param {string} token
 * @returns {Array<{ op: string, ver: ReturnType<parseSemver> }>}
 */
function parseComparatorToken(token) {
  const s = token.trim();
  if (!s || s === '*') return [];
  if (s.startsWith('~')) return expandTilde(s.slice(1).trim());
  if (s.startsWith('^')) return expandCaret(s.slice(1).trim());

  const opMatch = s.match(/^(>=|<=|>|<|={1,2})\s*(.+)$/);
  if (opMatch) {
    try { return [{ op: opMatch[1].replace('==', '='), ver: parseSemver(opMatch[2]) }]; }
    catch { return []; }
  }

  // X-range or bare version
  if (/[xX*]/.test(s) || /^\d+(\.\d+)?$/.test(s)) return expandXRange(s);

  try { return [{ op: '=', ver: parseSemver(s) }]; }
  catch { return []; }
}

/**
 * Tests whether a version string satisfies an npm range string.
 * The range may contain || (OR) and space-separated AND comparators.
 * An empty range or "*" matches every version.
 * @param {string} versionStr
 * @param {string} rangeStr
 * @returns {boolean}
 */
function satisfiesRange(versionStr, rangeStr) {
  let v;
  try { v = parseSemver(versionStr); }
  catch { return false; }

  const orParts = rangeStr.split('||').map(s => s.trim());

  return orParts.some(andPart => {
    if (!andPart || andPart === '*') return true;
    const comparators = andPart.split(/\s+/).filter(Boolean).flatMap(parseComparatorToken);
    return comparators.every(c => satisfiesComparator(v, c));
  });
}

/**
 * Resolves the best matching version from a list of all published versions
 * for a given npm range spec.
 * Prefers stable (non-pre-release) versions unless the spec itself is a
 * pre-release pin or no stable version satisfies the range.
 * Falls back to the absolute latest when nothing satisfies.
 * Same interface as python/versionResolver.js resolveVersion.
 * @param {string|null} versionSpec - npm range string, e.g. "^1.2.3", ">=1.0.0 <2.0.0"
 * @param {string[]} allVersions - all published versions (unsorted)
 * @returns {{ version: string, isLatest: boolean }}
 */
function resolveVersion(versionSpec, allVersions) {
  if (!allVersions || allVersions.length === 0) return { version: 'unknown', isLatest: true };

  const sortedDesc = (versions) =>
    [...versions].sort((a, b) => {
      try { return compareSemver(parseSemver(b), parseSemver(a)); }
      catch { return 0; }
    });

  const spec = (versionSpec ?? '').trim();
  const isAny = !spec || spec === '*' || spec === 'latest' || spec === '';

  if (isAny) {
    const stable = allVersions.filter(v => !isPreRelease(v));
    const pool   = stable.length > 0 ? stable : allVersions;
    const sorted = sortedDesc(pool);
    return { version: sorted[0], isLatest: true };
  }

  const sortedStable = sortedDesc(allVersions.filter(v => !isPreRelease(v)));
  for (const v of sortedStable) {
    if (satisfiesRange(v, spec)) return { version: v, isLatest: v === sortedStable[0] };
  }

  // Retry including pre-releases
  const allSorted = sortedDesc(allVersions);
  for (const v of allSorted) {
    if (satisfiesRange(v, spec)) return { version: v, isLatest: v === allSorted[0] };
  }

  // No match — return latest stable as fallback
  const fallback = sortedStable.length > 0 ? sortedStable[0] : allSorted[0];
  return { version: fallback ?? allVersions[0], isLatest: true };
}

export { parseSemver, compareSemver, isPreRelease, satisfiesRange, resolveVersion };
