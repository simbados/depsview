/**
 * Smoke tests for parserCore.js — verifies the module can be imported and that
 * all six exported functions produce correct output without any Node.js imports.
 * These tests mirror the coverage in parser.test.js but import directly from the
 * browser-compatible module so a bad import (e.g. adding node:fs) would fail here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDependencyString,
  parseRequiresDist,
  parsePyprojectToml,
  parseSetupCfg,
  parsePipfile,
  parseManifestJson,
} from '../src/parserCore.js';

// ── parseDependencyString ──────────────────────────────────────────────────────

describe('parseDependencyString', () => {
  it('parses a bare package name', () => {
    assert.deepEqual(parseDependencyString('requests'), { name: 'requests', versionSpec: null });
  });

  it('parses a package with a version constraint', () => {
    assert.deepEqual(parseDependencyString('requests>=2.0'), { name: 'requests', versionSpec: '>=2.0' });
  });

  it('strips extras', () => {
    assert.deepEqual(parseDependencyString('requests[security]>=2.0'), { name: 'requests', versionSpec: '>=2.0' });
  });

  it('strips parenthesised version', () => {
    assert.deepEqual(parseDependencyString('click (>=7.0)'), { name: 'click', versionSpec: '>=7.0' });
  });

  it('returns null for a URL', () => {
    assert.equal(parseDependencyString('https://example.com/pkg.tar.gz'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseDependencyString(''), null);
  });
});

// ── parseRequiresDist ──────────────────────────────────────────────────────────

describe('parseRequiresDist', () => {
  it('parses a plain dep', () => {
    assert.deepEqual(parseRequiresDist('requests>=2.0'), { name: 'requests', versionSpec: '>=2.0' });
  });

  it('skips extras-conditional deps', () => {
    assert.equal(parseRequiresDist('pytest; extra == "test"'), null);
  });

  it('keeps deps with non-extras markers', () => {
    const result = parseRequiresDist('pywin32; sys_platform == "win32"');
    assert.equal(result?.name, 'pywin32');
  });
});

// ── parsePyprojectToml ─────────────────────────────────────────────────────────

describe('parsePyprojectToml', () => {
  it('parses PEP 621 [project] dependencies', () => {
    const content = `
[project]
dependencies = [
  "requests>=2.28",
  "click>=8.0",
]
`;
    const deps = parsePyprojectToml(content);
    assert.equal(deps.length, 2);
    assert.equal(deps[0].name, 'requests');
    assert.equal(deps[1].name, 'click');
  });

  it('parses Poetry [tool.poetry.dependencies]', () => {
    const content = `
[tool.poetry.dependencies]
python = "^3.9"
requests = "^2.28"
click = "^8.0"
`;
    const deps = parsePyprojectToml(content);
    assert.equal(deps.length, 2);
    assert.equal(deps[0].name, 'requests');
    assert.equal(deps[1].name, 'click');
  });

  it('includes Poetry dev deps when includeTests is true', () => {
    const content = `
[tool.poetry.dependencies]
requests = "^2.28"

[tool.poetry.dev-dependencies]
pytest = "^7.0"
`;
    const deps = parsePyprojectToml(content, true);
    assert.ok(deps.some(d => d.name === 'pytest'));
  });

  it('excludes Poetry dev deps when includeTests is false', () => {
    const content = `
[tool.poetry.dependencies]
requests = "^2.28"

[tool.poetry.dev-dependencies]
pytest = "^7.0"
`;
    const deps = parsePyprojectToml(content, false);
    assert.ok(!deps.some(d => d.name === 'pytest'));
  });
});

// ── parseSetupCfg ──────────────────────────────────────────────────────────────

describe('parseSetupCfg', () => {
  it('parses install_requires', () => {
    const content = `
[options]
install_requires =
    requests>=2.0
    click>=7.0
`;
    const deps = parseSetupCfg(content);
    assert.equal(deps.length, 2);
    assert.equal(deps[0].name, 'requests');
    assert.equal(deps[1].name, 'click');
  });

  it('returns empty array when no install_requires', () => {
    assert.deepEqual(parseSetupCfg('[metadata]\nname = mypackage\n'), []);
  });
});

// ── parsePipfile ───────────────────────────────────────────────────────────────

describe('parsePipfile', () => {
  it('parses [packages]', () => {
    const content = `
[packages]
requests = ">=2.0"
click = "*"
`;
    const deps = parsePipfile(content);
    assert.equal(deps.length, 2);
    assert.equal(deps[0].name, 'requests');
    assert.equal(deps[0].versionSpec, '>=2.0');
    assert.equal(deps[1].versionSpec, null);
  });

  it('includes [dev-packages] when includeTests is true', () => {
    const content = `
[packages]
requests = "*"

[dev-packages]
pytest = "*"
`;
    const deps = parsePipfile(content, true);
    assert.ok(deps.some(d => d.name === 'pytest'));
  });

  it('excludes [dev-packages] when includeTests is false', () => {
    const content = `
[packages]
requests = "*"

[dev-packages]
pytest = "*"
`;
    const deps = parsePipfile(content, false);
    assert.ok(!deps.some(d => d.name === 'pytest'));
  });
});

// ── parseManifestJson ──────────────────────────────────────────────────────────

describe('parseManifestJson', () => {
  it('parses requirements array', () => {
    const content = JSON.stringify({
      domain: 'my_integration',
      requirements: ['requests>=2.28', 'aiohttp>=3.0'],
    });
    const deps = parseManifestJson(content);
    assert.equal(deps.length, 2);
    assert.equal(deps[0].name, 'requests');
    assert.equal(deps[1].name, 'aiohttp');
  });

  it('returns empty array when requirements is absent', () => {
    const content = JSON.stringify({ domain: 'my_integration' });
    assert.deepEqual(parseManifestJson(content), []);
  });
});
