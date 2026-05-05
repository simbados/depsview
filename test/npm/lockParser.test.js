import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePackageLock } from '../../src/npm/lockParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures  = path.join(__dirname, '../fixtures');

function readFixture(name) {
  return fs.readFileSync(path.join(fixtures, name, 'package-lock.json'), 'utf8');
}

describe('parsePackageLock — v2 lockfile', () => {
  const content = readFixture('npm-lockv2');

  it('returns all non-dev packages (2) by default', () => {
    const deps = parsePackageLock(content);
    assert.equal(deps.length, 2);
  });

  it('includes lodash', () => {
    const deps = parsePackageLock(content);
    assert.ok(deps.find(d => d.name === 'lodash'));
  });

  it('includes vite', () => {
    const deps = parsePackageLock(content);
    assert.ok(deps.find(d => d.name === 'vite'));
  });

  it('excludes dev package (eslint) by default', () => {
    const deps = parsePackageLock(content);
    assert.ok(!deps.find(d => d.name === 'eslint'));
  });

  it('includes dev package when includeTests is true', () => {
    const deps = parsePackageLock(content, true);
    assert.ok(deps.find(d => d.name === 'eslint'));
  });

  it('returns exactly 3 packages with includeTests', () => {
    assert.equal(parsePackageLock(content, true).length, 3);
  });

  it('returns exact versions from the lock file', () => {
    const lodash = parsePackageLock(content).find(d => d.name === 'lodash');
    assert.equal(lodash.version, '4.17.21');
  });

  it('all entries have name and version strings', () => {
    for (const dep of parsePackageLock(content, true)) {
      assert.equal(typeof dep.name,    'string');
      assert.equal(typeof dep.version, 'string');
    }
  });
});

describe('parsePackageLock — v1 lockfile', () => {
  const content = readFixture('npm-lockv1');

  it('returns 2 non-dev packages by default', () => {
    assert.equal(parsePackageLock(content).length, 2);
  });

  it('includes lodash', () => {
    assert.ok(parsePackageLock(content).find(d => d.name === 'lodash'));
  });

  it('excludes dev eslint by default', () => {
    assert.ok(!parsePackageLock(content).find(d => d.name === 'eslint'));
  });

  it('includes eslint with includeTests', () => {
    assert.ok(parsePackageLock(content, true).find(d => d.name === 'eslint'));
  });
});

describe('parsePackageLock — multiple versions at different paths (v2)', () => {
  const nestedLock = JSON.stringify({
    lockfileVersion: 2,
    packages: {
      '': {},
      'node_modules/lodash':                   { version: '4.17.21' },
      'node_modules/foo/node_modules/lodash':  { version: '3.10.1' },
    },
  });

  it('returns both versions when they differ', () => {
    const versions = parsePackageLock(nestedLock)
      .filter(d => d.name === 'lodash').map(d => d.version).sort();
    assert.deepEqual(versions, ['3.10.1', '4.17.21']);
  });

  it('returns two lodash entries for different versions', () => {
    assert.equal(parsePackageLock(nestedLock).filter(d => d.name === 'lodash').length, 2);
  });
});

describe('parsePackageLock — same name@version at multiple paths (v2)', () => {
  const sameLock = JSON.stringify({
    lockfileVersion: 2,
    packages: {
      '': {},
      'node_modules/lodash':                   { version: '4.17.21' },
      'node_modules/foo/node_modules/lodash':  { version: '4.17.21' },
    },
  });

  it('deduplicates identical name@version appearing at multiple paths', () => {
    assert.equal(sameLock && parsePackageLock(sameLock).filter(d => d.name === 'lodash').length, 1);
  });
});

describe('parsePackageLock — scoped packages (v2)', () => {
  const scopedLock = JSON.stringify({
    lockfileVersion: 2,
    packages: {
      '': {},
      'node_modules/@babel/core': { version: '7.21.0' },
    },
  });

  it('preserves scoped package name', () => {
    const deps = parsePackageLock(scopedLock);
    assert.ok(deps.find(d => d.name === '@babel/core'));
  });

  it('returns exact version for scoped package', () => {
    const dep = parsePackageLock(scopedLock).find(d => d.name === '@babel/core');
    assert.equal(dep.version, '7.21.0');
  });
});
