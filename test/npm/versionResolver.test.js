import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSemver, compareSemver, isPreRelease, satisfiesRange, resolveVersion } from '../../src/npm/versionResolver.js';

describe('parseSemver', () => {
  it('parses simple release', () => {
    const v = parseSemver('1.2.3');
    assert.deepEqual([v.major, v.minor, v.patch], [1, 2, 3]);
    assert.equal(v.pre, null);
  });

  it('strips leading v prefix', () => {
    const v = parseSemver('v2.0.0');
    assert.equal(v.major, 2);
  });

  it('strips build metadata', () => {
    const v = parseSemver('1.0.0+build.1');
    assert.equal(v.patch, 0);
    assert.equal(v.pre, null);
  });

  it('parses pre-release alpha', () => {
    const v = parseSemver('1.0.0-alpha.1');
    assert.deepEqual(v.pre, ['alpha', 1]);
  });

  it('parses numeric pre-release identifier', () => {
    const v = parseSemver('1.0.0-0.3.7');
    assert.deepEqual(v.pre, [0, 3, 7]);
  });
});

describe('compareSemver', () => {
  it('1.0.0 < 2.0.0', () => assert.ok(compareSemver(parseSemver('1.0.0'), parseSemver('2.0.0')) < 0));
  it('2.0.0 > 1.0.0', () => assert.ok(compareSemver(parseSemver('2.0.0'), parseSemver('1.0.0')) > 0));
  it('1.0.0 == 1.0.0', () => assert.equal(compareSemver(parseSemver('1.0.0'), parseSemver('1.0.0')), 0));
  it('1.0.0-alpha < 1.0.0', () => assert.ok(compareSemver(parseSemver('1.0.0-alpha'), parseSemver('1.0.0')) < 0));
  it('1.0.0 > 1.0.0-alpha', () => assert.ok(compareSemver(parseSemver('1.0.0'), parseSemver('1.0.0-alpha')) > 0));
  it('1.0.0-alpha < 1.0.0-beta', () => assert.ok(compareSemver(parseSemver('1.0.0-alpha'), parseSemver('1.0.0-beta')) < 0));
  it('1.0.0-1 < 1.0.0-alpha (numeric < string)', () => assert.ok(compareSemver(parseSemver('1.0.0-1'), parseSemver('1.0.0-alpha')) < 0));
});

describe('isPreRelease', () => {
  it('stable version is not pre-release', () => assert.ok(!isPreRelease('1.2.3')));
  it('alpha is pre-release', () => assert.ok(isPreRelease('1.0.0-alpha')));
  it('rc is pre-release', () => assert.ok(isPreRelease('2.0.0-rc.1')));
  it('beta is pre-release', () => assert.ok(isPreRelease('1.0.0-beta.1')));
});

describe('satisfiesRange — exact', () => {
  it('1.2.3 satisfies 1.2.3', () => assert.ok(satisfiesRange('1.2.3', '1.2.3')));
  it('1.2.4 does not satisfy 1.2.3', () => assert.ok(!satisfiesRange('1.2.4', '1.2.3')));
});

describe('satisfiesRange — caret ^', () => {
  it('1.2.3 satisfies ^1.0.0', () => assert.ok(satisfiesRange('1.2.3', '^1.0.0')));
  it('2.0.0 does not satisfy ^1.0.0', () => assert.ok(!satisfiesRange('2.0.0', '^1.0.0')));
  it('0.2.3 satisfies ^0.2.0', () => assert.ok(satisfiesRange('0.2.3', '^0.2.0')));
  it('0.3.0 does not satisfy ^0.2.0', () => assert.ok(!satisfiesRange('0.3.0', '^0.2.0')));
  it('0.0.4 satisfies ^0.0.3', () => assert.ok(!satisfiesRange('0.0.4', '^0.0.3')));
});

describe('satisfiesRange — tilde ~', () => {
  it('1.2.4 satisfies ~1.2.3', () => assert.ok(satisfiesRange('1.2.4', '~1.2.3')));
  it('1.3.0 does not satisfy ~1.2.3', () => assert.ok(!satisfiesRange('1.3.0', '~1.2.3')));
  it('1.2.0 satisfies ~1.2', () => assert.ok(satisfiesRange('1.2.0', '~1.2')));
  it('1.3.0 does not satisfy ~1.2', () => assert.ok(!satisfiesRange('1.3.0', '~1.2')));
});

describe('satisfiesRange — comparators', () => {
  it('2.0.0 satisfies >=2.0.0', () => assert.ok(satisfiesRange('2.0.0', '>=2.0.0')));
  it('1.9.9 does not satisfy >=2.0.0', () => assert.ok(!satisfiesRange('1.9.9', '>=2.0.0')));
  it('1.5.0 satisfies >=1.0.0 <2.0.0', () => assert.ok(satisfiesRange('1.5.0', '>=1.0.0 <2.0.0')));
  it('2.0.0 does not satisfy >=1.0.0 <2.0.0', () => assert.ok(!satisfiesRange('2.0.0', '>=1.0.0 <2.0.0')));
});

describe('satisfiesRange — x-range', () => {
  it('1.5.0 satisfies 1.x', () => assert.ok(satisfiesRange('1.5.0', '1.x')));
  it('2.0.0 does not satisfy 1.x', () => assert.ok(!satisfiesRange('2.0.0', '1.x')));
  it('1.2.9 satisfies 1.2.x', () => assert.ok(satisfiesRange('1.2.9', '1.2.x')));
  it('1.3.0 does not satisfy 1.2.x', () => assert.ok(!satisfiesRange('1.3.0', '1.2.x')));
});

describe('satisfiesRange — OR operator ||', () => {
  it('1.0.0 satisfies 1.x || 3.x', () => assert.ok(satisfiesRange('1.0.0', '1.x || 3.x')));
  it('3.0.0 satisfies 1.x || 3.x', () => assert.ok(satisfiesRange('3.0.0', '1.x || 3.x')));
  it('2.0.0 does not satisfy 1.x || 3.x', () => assert.ok(!satisfiesRange('2.0.0', '1.x || 3.x')));
});

describe('satisfiesRange — wildcard / empty', () => {
  it('any version satisfies *', () => assert.ok(satisfiesRange('9.9.9', '*')));
  it('any version satisfies empty string', () => assert.ok(satisfiesRange('1.0.0', '')));
});

describe('resolveVersion — no constraint', () => {
  it('returns latest stable version for null spec', () => {
    const { version } = resolveVersion(null, ['1.0.0', '2.0.0', '2.1.0']);
    assert.equal(version, '2.1.0');
  });

  it('filters pre-releases when stable versions exist', () => {
    const { version } = resolveVersion(null, ['1.0.0', '2.0.0-alpha.1']);
    assert.equal(version, '1.0.0');
  });

  it('returns unknown for empty version list', () => {
    assert.equal(resolveVersion('^1.0.0', []).version, 'unknown');
  });
});

describe('resolveVersion — caret', () => {
  it('returns highest ^1 match', () => {
    const { version } = resolveVersion('^1.0.0', ['0.9.0', '1.0.0', '1.5.3', '2.0.0']);
    assert.equal(version, '1.5.3');
  });
});

describe('resolveVersion — tilde', () => {
  it('returns highest ~1.2 match', () => {
    const { version } = resolveVersion('~1.2.0', ['1.1.9', '1.2.0', '1.2.8', '1.3.0']);
    assert.equal(version, '1.2.8');
  });
});

describe('resolveVersion — fallback', () => {
  it('returns latest when nothing satisfies the range', () => {
    const { version } = resolveVersion('^5.0.0', ['1.0.0', '2.0.0']);
    assert.equal(version, '2.0.0');
  });
});
