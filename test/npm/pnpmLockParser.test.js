import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePnpmLock } from '../../src/npm/pnpmLockParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures  = path.join(__dirname, '../fixtures');

function readFixture(name) {
  return fs.readFileSync(path.join(fixtures, name, 'pnpm-lock.yaml'), 'utf8');
}

// ── v5 ────────────────────────────────────────────────────────────────────────

describe('parsePnpmLock — v5 lockfile', () => {
  const content = readFixture('pnpm-v5');

  it('returns 2 non-dev packages by default', () => {
    assert.equal(parsePnpmLock(content).length, 2);
  });

  it('includes lodash', () => {
    assert.ok(parsePnpmLock(content).find(d => d.name === 'lodash'));
  });

  it('includes vite', () => {
    assert.ok(parsePnpmLock(content).find(d => d.name === 'vite'));
  });

  it('excludes dev eslint by default', () => {
    assert.ok(!parsePnpmLock(content).find(d => d.name === 'eslint'));
  });

  it('includes eslint with includeTests', () => {
    assert.ok(parsePnpmLock(content, true).find(d => d.name === 'eslint'));
  });

  it('returns exactly 3 packages with includeTests', () => {
    assert.equal(parsePnpmLock(content, true).length, 3);
  });

  it('returns exact versions', () => {
    const lodash = parsePnpmLock(content).find(d => d.name === 'lodash');
    assert.equal(lodash.version, '4.17.21');
  });

  it('all entries have name and version strings', () => {
    for (const dep of parsePnpmLock(content, true)) {
      assert.equal(typeof dep.name, 'string');
      assert.equal(typeof dep.version, 'string');
    }
  });
});

// ── v6 ────────────────────────────────────────────────────────────────────────

describe('parsePnpmLock — v6 lockfile', () => {
  const content = readFixture('pnpm-v6');

  it('returns 2 non-dev packages by default', () => {
    assert.equal(parsePnpmLock(content).length, 2);
  });

  it('includes lodash', () => {
    assert.ok(parsePnpmLock(content).find(d => d.name === 'lodash'));
  });

  it('includes vite', () => {
    assert.ok(parsePnpmLock(content).find(d => d.name === 'vite'));
  });

  it('excludes dev eslint by default', () => {
    assert.ok(!parsePnpmLock(content).find(d => d.name === 'eslint'));
  });

  it('includes eslint with includeTests', () => {
    assert.ok(parsePnpmLock(content, true).find(d => d.name === 'eslint'));
  });

  it('returns exact versions', () => {
    const vite = parsePnpmLock(content).find(d => d.name === 'vite');
    assert.equal(vite.version, '5.1.0');
  });
});

// ── v9 ────────────────────────────────────────────────────────────────────────

describe('parsePnpmLock — v9 lockfile', () => {
  const content = readFixture('pnpm-v9');

  it('returns 2 non-dev packages by default', () => {
    assert.equal(parsePnpmLock(content).length, 2);
  });

  it('includes lodash', () => {
    assert.ok(parsePnpmLock(content).find(d => d.name === 'lodash'));
  });

  it('includes vite', () => {
    assert.ok(parsePnpmLock(content).find(d => d.name === 'vite'));
  });

  it('excludes dev eslint by default (detected from importers section)', () => {
    assert.ok(!parsePnpmLock(content).find(d => d.name === 'eslint'));
  });

  it('includes eslint with includeTests', () => {
    assert.ok(parsePnpmLock(content, true).find(d => d.name === 'eslint'));
  });

  it('returns exact versions', () => {
    const lodash = parsePnpmLock(content).find(d => d.name === 'lodash');
    assert.equal(lodash.version, '4.17.21');
  });

  it('does not include packages from snapshots: section', () => {
    // All three packages appear in both packages: and snapshots:; count must be 3 total
    assert.equal(parsePnpmLock(content, true).length, 3);
  });
});

// ── edge cases ────────────────────────────────────────────────────────────────

describe('parsePnpmLock — scoped packages (v6)', () => {
  const scopedLock = `lockfileVersion: '6.0'\n\npackages:\n\n  /@babel/core@7.24.0:\n    resolution: {integrity: sha512-xxx}\n    dev: false\n`;

  it('preserves scoped package name', () => {
    const deps = parsePnpmLock(scopedLock);
    assert.ok(deps.find(d => d.name === '@babel/core'));
  });

  it('returns exact version for scoped package', () => {
    const dep = parsePnpmLock(scopedLock).find(d => d.name === '@babel/core');
    assert.equal(dep.version, '7.24.0');
  });
});

describe('parsePnpmLock — peer-dep suffix stripped (v9)', () => {
  const peerLock = `lockfileVersion: '9.0'\n\npackages:\n\n  eslint@8.57.0(typescript@5.0.0):\n    resolution: {integrity: sha512-xxx}\n`;

  it('strips peer-dep suffix from version', () => {
    const dep = parsePnpmLock(peerLock, true).find(d => d.name === 'eslint');
    assert.ok(dep, 'eslint entry should exist');
    assert.equal(dep.version, '8.57.0');
  });
});

describe('parsePnpmLock — multiple versions (v6)', () => {
  const dupLock = `lockfileVersion: '6.0'\n\npackages:\n\n  /lodash@4.17.21:\n    resolution: {integrity: sha512-aaa}\n    dev: false\n\n  /lodash@3.10.1:\n    resolution: {integrity: sha512-bbb}\n    dev: false\n`;

  it('returns both versions when they differ', () => {
    const versions = parsePnpmLock(dupLock)
      .filter(d => d.name === 'lodash').map(d => d.version).sort();
    assert.deepEqual(versions, ['3.10.1', '4.17.21']);
  });

  it('returns two lodash entries for different versions', () => {
    assert.equal(parsePnpmLock(dupLock).filter(d => d.name === 'lodash').length, 2);
  });
});

describe('parsePnpmLock — empty input', () => {
  it('returns empty array for empty string', () => {
    assert.equal(parsePnpmLock('').length, 0);
  });

  it('returns empty array for lockfile with no packages section', () => {
    assert.equal(parsePnpmLock('lockfileVersion: 5.4\n').length, 0);
  });
});
