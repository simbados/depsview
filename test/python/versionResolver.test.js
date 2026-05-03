/**
 * Tests for src/versionResolver.js.
 * Uses a fixed set of mock version strings so tests are deterministic and
 * do not require any network access.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVersion, parseVersionSpec, parseVersion, isPreRelease } from '../../src/python/versionResolver.js';

/**
 * A realistic mock version list covering stable releases, pre-releases, and post-releases.
 * Used as the "all versions from PyPI" input for resolveVersion tests.
 * @type {string[]}
 */
const VERSIONS = [
  '1.0.0', '1.1.0', '1.2.0', '1.2.1', '1.2.2',
  '2.0.0', '2.0.1', '2.1.0', '2.28.0', '2.28.1', '2.28.2',
  '2.29.0', '2.30.0', '2.31.0', '2.31.0.post1',
  '3.0.0a1', '3.0.0b1', '3.0.0rc1',
];

// ── parseVersionSpec ──────────────────────────────────────────────────────────

describe('parseVersionSpec', () => {
  /**
   * Null and empty inputs should return an empty constraint list (meaning "any version").
   */
  test('returns empty array for null', () => {
    assert.deepEqual(parseVersionSpec(null), []);
  });

  test('returns empty array for empty string', () => {
    assert.deepEqual(parseVersionSpec(''), []);
  });

  test('returns empty array for bare wildcard "*"', () => {
    assert.deepEqual(parseVersionSpec('*'), []);
  });

  /**
   * A single constraint should produce a one-element array.
   */
  test('parses single >= constraint', () => {
    assert.deepEqual(parseVersionSpec('>=2.0'), [['>=', '2.0']]);
  });

  /**
   * Comma-separated constraints should each become their own [op, version] pair.
   */
  test('parses comma-separated constraints', () => {
    assert.deepEqual(parseVersionSpec('>=2.0,<3.0'), [['>=', '2.0'], ['<', '3.0']]);
  });

  test('parses exclusion with lower bound', () => {
    assert.deepEqual(parseVersionSpec('!=2.29.0,>=2.28.0'), [['!=', '2.29.0'], ['>=', '2.28.0']]);
  });

  test('parses compatible release (~=)', () => {
    assert.deepEqual(parseVersionSpec('~=2.28'), [['~=', '2.28']]);
  });
});

// ── parseVersion ──────────────────────────────────────────────────────────────

describe('parseVersion', () => {
  /**
   * A simple three-segment version should produce the expected release array.
   */
  test('parses simple version into release segments', () => {
    const v = parseVersion('2.31.0');
    assert.deepEqual(v.release, [2, 31, 0]);
    assert.equal(v.epoch, 0);
    assert.equal(v.pre, null);
    assert.equal(v.post, null);
    assert.equal(v.dev, null);
  });

  /**
   * Alpha pre-release should have pre=[0, 1] (type 0 = alpha, num 1).
   */
  test('parses alpha pre-release', () => {
    const v = parseVersion('3.0.0a1');
    assert.deepEqual(v.release, [3, 0, 0]);
    assert.deepEqual(v.pre, [0, 1]);
  });

  /**
   * Release candidate should have pre=[2, 1] (type 2 = rc, num 1).
   */
  test('parses release candidate', () => {
    const v = parseVersion('3.0.0rc1');
    assert.deepEqual(v.pre, [2, 1]);
  });

  /**
   * Post-release should set post to the numeric suffix.
   */
  test('parses post release', () => {
    const v = parseVersion('2.31.0.post1');
    assert.equal(v.post, 1);
    assert.equal(v.pre, null);
  });
});

// ── isPreRelease ──────────────────────────────────────────────────────────────

describe('isPreRelease', () => {
  test('stable version is not pre-release', () => {
    assert.equal(isPreRelease('2.31.0'), false);
  });

  test('alpha is pre-release', () => {
    assert.equal(isPreRelease('3.0.0a1'), true);
  });

  test('beta is pre-release', () => {
    assert.equal(isPreRelease('3.0.0b2'), true);
  });

  test('release candidate is pre-release', () => {
    assert.equal(isPreRelease('3.0.0rc1'), true);
  });

  test('dev release is pre-release', () => {
    assert.equal(isPreRelease('1.0.dev0'), true);
  });

  test('post release is not pre-release', () => {
    assert.equal(isPreRelease('2.31.0.post1'), false);
  });
});

// ── resolveVersion — no constraint ───────────────────────────────────────────

describe('resolveVersion — no constraint', () => {
  /**
   * When versionSpec is null, the resolver should return the latest stable version
   * (not a pre-release), which is 2.31.0.post1 → wait, post1 is stable.
   * Actually the highest stable is 2.31.0.post1 (post > release).
   */
  test('returns highest stable version when spec is null', () => {
    const { version } = resolveVersion(null, VERSIONS);
    assert.equal(version, '2.31.0.post1');
  });

  test('returns highest stable version when spec is empty string', () => {
    const { version } = resolveVersion('', VERSIONS);
    assert.equal(version, '2.31.0.post1');
  });

  /**
   * When only pre-release versions are available, the resolver falls back to
   * returning the latest pre-release rather than failing.
   */
  test('falls back to pre-release when no stable version exists', () => {
    const { version } = resolveVersion(null, ['1.0.0a1', '1.0.0b1', '1.0.0rc1']);
    assert.equal(version, '1.0.0rc1');
  });
});

// ── resolveVersion — exact pin (==) ──────────────────────────────────────────

describe('resolveVersion — exact pin (==)', () => {
  /**
   * An exact == constraint should return precisely that version.
   */
  test('returns the pinned version', () => {
    const { version } = resolveVersion('==2.28.1', VERSIONS);
    assert.equal(version, '2.28.1');
  });

  /**
   * If the pinned version does not exist in the list, falls back to latest.
   */
  test('falls back to latest when exact version is not in list', () => {
    const { version } = resolveVersion('==9.9.9', VERSIONS);
    // No match found — should fall back to the highest stable version
    assert.equal(version, '2.31.0.post1');
  });
});

// ── resolveVersion — minimum bound (>=) ──────────────────────────────────────

describe('resolveVersion — minimum bound (>=)', () => {
  /**
   * Should return the highest version that satisfies the lower bound.
   */
  test('returns highest version satisfying >=2.0', () => {
    const { version } = resolveVersion('>=2.0', VERSIONS);
    assert.equal(version, '2.31.0.post1');
  });

  test('returns highest version satisfying >=2.28.0', () => {
    const { version } = resolveVersion('>=2.28.0', VERSIONS);
    assert.equal(version, '2.31.0.post1');
  });
});

// ── resolveVersion — upper bound (<, <=) ─────────────────────────────────────

describe('resolveVersion — upper bound', () => {
  /**
   * A strict upper bound should exclude the boundary version itself.
   */
  test('excludes boundary version with < operator', () => {
    const { version } = resolveVersion('<2.29.0', VERSIONS);
    assert.equal(version, '2.28.2');
  });

  /**
   * A non-strict upper bound should include the boundary version.
   */
  test('includes boundary version with <= operator', () => {
    const { version } = resolveVersion('<=2.29.0', VERSIONS);
    assert.equal(version, '2.29.0');
  });
});

// ── resolveVersion — range (>=,<) ────────────────────────────────────────────

describe('resolveVersion — range (>=,<)', () => {
  /**
   * Should return the highest stable version within the specified range.
   */
  test('returns highest version within >=2.0,<3.0', () => {
    const { version } = resolveVersion('>=2.0,<3.0', VERSIONS);
    assert.equal(version, '2.31.0.post1');
  });

  test('returns highest version within >=2.28.0,<2.30.0', () => {
    const { version } = resolveVersion('>=2.28.0,<2.30.0', VERSIONS);
    assert.equal(version, '2.29.0');
  });

  test('returns highest version within >=1.0,<2.0', () => {
    const { version } = resolveVersion('>=1.0,<2.0', VERSIONS);
    assert.equal(version, '1.2.2');
  });
});

// ── resolveVersion — exclusion (!=) ──────────────────────────────────────────

describe('resolveVersion — exclusion (!=)', () => {
  /**
   * An excluded version should be skipped in favour of the next highest.
   */
  test('skips the excluded version', () => {
    const { version } = resolveVersion('!=2.31.0.post1,>=2.28.0', VERSIONS);
    assert.equal(version, '2.31.0');
  });

  test('skips multiple excluded versions', () => {
    const { version } = resolveVersion('!=2.31.0.post1,!=2.31.0,>=2.28.0', VERSIONS);
    assert.equal(version, '2.30.0');
  });
});

// ── resolveVersion — compatible release (~=) ─────────────────────────────────

describe('resolveVersion — compatible release (~=)', () => {
  /**
   * ~=2.28 means >=2.28, <3 — should pick the highest 2.x version.
   */
  test('~=2.28 returns highest 2.x version', () => {
    const { version } = resolveVersion('~=2.28', VERSIONS);
    assert.equal(version, '2.31.0.post1');
  });

  /**
   * ~=2.28.1 means >=2.28.1, <2.29 — should stay within 2.28.x.
   */
  test('~=2.28.1 stays within 2.28.x', () => {
    const { version } = resolveVersion('~=2.28.1', VERSIONS);
    assert.equal(version, '2.28.2');
  });

  /**
   * ~=1.2 means >=1.2, <2 — should not cross the major version boundary.
   */
  test('~=1.2 does not cross major version boundary', () => {
    const { version } = resolveVersion('~=1.2', VERSIONS);
    assert.equal(version, '1.2.2');
  });
});

// ── resolveVersion — wildcard (==X.Y.*) ──────────────────────────────────────

describe('resolveVersion — wildcard equality (==X.Y.*)', () => {
  /**
   * A wildcard spec should match all versions with the given prefix.
   */
  test('==2.28.* returns highest 2.28.x', () => {
    const { version } = resolveVersion('==2.28.*', VERSIONS);
    assert.equal(version, '2.28.2');
  });

  test('==1.* returns highest 1.x', () => {
    const { version } = resolveVersion('==1.*', VERSIONS);
    assert.equal(version, '1.2.2');
  });
});

// ── resolveVersion — pre-release filtering ───────────────────────────────────

describe('resolveVersion — pre-release filtering', () => {
  /**
   * When stable versions are available, pre-releases should be ignored even if
   * they are technically higher version numbers.
   */
  test('ignores pre-releases when stable versions exist', () => {
    const { version } = resolveVersion('>=1.0', VERSIONS);
    // 3.0.0rc1 is numerically higher but is a pre-release
    assert.ok(!isPreRelease(version), `Expected stable version, got ${version}`);
  });

  /**
   * An explicit == pin targeting a pre-release version should be honoured.
   */
  test('honours explicit == pin to a pre-release', () => {
    const { version } = resolveVersion('==3.0.0a1', VERSIONS);
    assert.equal(version, '3.0.0a1');
  });
});

// ── resolveVersion — empty version list ──────────────────────────────────────

describe('resolveVersion — edge cases', () => {
  /**
   * An empty version list should return "unknown" without throwing.
   */
  test('returns "unknown" for empty version list', () => {
    const { version } = resolveVersion('>=1.0', []);
    assert.equal(version, 'unknown');
  });

  test('returns "unknown" for null version list', () => {
    const { version } = resolveVersion('>=1.0', null);
    assert.equal(version, 'unknown');
  });
});
