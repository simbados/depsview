import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePackageJson, isNonRegistrySpec } from '../../src/npm/parserCore.js';

describe('isNonRegistrySpec', () => {
  it('returns true for file: prefix', () => assert.ok(isNonRegistrySpec('file:../local')));
  it('returns true for link: prefix', () => assert.ok(isNonRegistrySpec('link:../pkg')));
  it('returns true for workspace: prefix', () => assert.ok(isNonRegistrySpec('workspace:*')));
  it('returns true for git+ prefix', () => assert.ok(isNonRegistrySpec('git+https://github.com/x/y')));
  it('returns true for https: prefix', () => assert.ok(isNonRegistrySpec('https://example.com/pkg.tgz')));
  it('returns true for relative path ./', () => assert.ok(isNonRegistrySpec('./local')));
  it('returns true for non-string', () => assert.ok(isNonRegistrySpec(null)));
  it('returns false for plain semver range', () => assert.ok(!isNonRegistrySpec('^1.2.3')));
  it('returns false for exact version', () => assert.ok(!isNonRegistrySpec('4.17.21')));
  it('returns false for *', () => assert.ok(!isNonRegistrySpec('*')));
});

describe('parsePackageJson — dependencies only', () => {
  const content = JSON.stringify({
    dependencies:    { lodash: '^4.17.21', vite: '^5.0.0' },
    devDependencies: { eslint: '^8.0.0' },
  });

  it('returns exactly 2 deps by default', () => {
    assert.equal(parsePackageJson(content).length, 2);
  });

  it('parses lodash spec', () => {
    const dep = parsePackageJson(content).find(d => d.name === 'lodash');
    assert.equal(dep.versionSpec, '^4.17.21');
  });

  it('parses vite spec', () => {
    const dep = parsePackageJson(content).find(d => d.name === 'vite');
    assert.equal(dep.versionSpec, '^5.0.0');
  });

  it('excludes devDependencies by default', () => {
    assert.ok(!parsePackageJson(content).find(d => d.name === 'eslint'));
  });
});

describe('parsePackageJson — includeTests: true', () => {
  const content = JSON.stringify({
    dependencies:    { lodash: '^4.17.21' },
    devDependencies: { eslint: '^8.0.0', vite: '^5.0.0' },
  });

  it('returns 3 deps with includeTests', () => {
    assert.equal(parsePackageJson(content, true).length, 3);
  });

  it('includes eslint when includeTests is true', () => {
    assert.ok(parsePackageJson(content, true).find(d => d.name === 'eslint'));
  });
});

describe('parsePackageJson — non-registry specs skipped', () => {
  const content = JSON.stringify({
    dependencies: {
      local:    'file:../local',
      hosted:   'git+https://github.com/org/repo',
      ws:       'workspace:*',
      valid:    '^1.0.0',
    },
  });

  it('only includes the registry-resolvable entry', () => {
    const deps = parsePackageJson(content);
    assert.equal(deps.length, 1);
    assert.equal(deps[0].name, 'valid');
  });
});

describe('parsePackageJson — scoped packages', () => {
  const content = JSON.stringify({
    dependencies: { '@babel/core': '^7.0.0', '@types/node': '^20.0.0' },
  });

  it('preserves scoped package names', () => {
    const deps = parsePackageJson(content);
    assert.equal(deps.length, 2);
    assert.ok(deps.find(d => d.name === '@babel/core'));
    assert.ok(deps.find(d => d.name === '@types/node'));
  });
});

describe('parsePackageJson — empty sections', () => {
  it('returns empty array when dependencies is absent', () => {
    assert.deepEqual(parsePackageJson(JSON.stringify({})), []);
  });

  it('returns empty array when dependencies is empty object', () => {
    assert.deepEqual(parsePackageJson(JSON.stringify({ dependencies: {} })), []);
  });

  it('treats empty string spec as null versionSpec', () => {
    const content = JSON.stringify({ dependencies: { lodash: '' } });
    const deps = parsePackageJson(content);
    assert.equal(deps[0].versionSpec, null);
  });
});
