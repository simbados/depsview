/**
 * Tests for the pure utility functions exported from web/app.js.
 * DOM-manipulation functions (renderResults, appendProgress, etc.) require a
 * browser environment and cannot be tested with the Node.js test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatNumber, daysSince, sortResults, detectEcosystem } from '../web/app.js';

// ── formatNumber ───────────────────────────────────────────────────────────────

describe('formatNumber', () => {
  it('returns "–" for null', () => {
    assert.equal(formatNumber(null), '–');
  });

  it('returns "–" for undefined', () => {
    assert.equal(formatNumber(undefined), '–');
  });

  it('formats 0 as a string', () => {
    assert.equal(formatNumber(0), '0');
  });

  it('formats a plain integer without separators', () => {
    assert.equal(formatNumber(42), '42');
  });

  it('formats a four-digit number with a thousand separator', () => {
    // toLocaleString output is locale-dependent, so just check it contains the digits
    const result = formatNumber(1234);
    assert.match(result, /1.234/); // "." matches any separator character (comma or period)
  });

  it('formats a large number with separators', () => {
    const result = formatNumber(1_234_567);
    assert.match(result, /1.234.567/);
  });
});

// ── daysSince ──────────────────────────────────────────────────────────────────

describe('daysSince', () => {
  it('returns Infinity for the sentinel value "unknown"', () => {
    assert.equal(daysSince('unknown'), Infinity);
  });

  it('returns Infinity for null', () => {
    assert.equal(daysSince(null), Infinity);
  });

  it('returns Infinity for undefined', () => {
    assert.equal(daysSince(undefined), Infinity);
  });

  it('returns Infinity for an empty string', () => {
    assert.equal(daysSince(''), Infinity);
  });

  it('returns Infinity for an unparseable string', () => {
    assert.equal(daysSince('not-a-date'), Infinity);
  });

  it('returns 0 for today', () => {
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(daysSince(today), 0);
  });

  it('returns a positive integer for a past date', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    assert.equal(daysSince(threeDaysAgo), 3);
  });

  it('returns a large number for an old date', () => {
    assert.ok(daysSince('2011-01-01') > 3000);
  });
});

// ── sortResults ────────────────────────────────────────────────────────────────

describe('sortResults', () => {
  it('returns an empty array for an empty Map', () => {
    assert.deepEqual(sortResults(new Map()), []);
  });

  it('returns a single-entry array unchanged', () => {
    const map = new Map([['a', { name: 'alpha', releaseDate: '2024-01-01' }]]);
    assert.equal(sortResults(map).length, 1);
    assert.equal(sortResults(map)[0].name, 'alpha');
  });

  it('sorts newest release date first', () => {
    const map = new Map([
      ['a', { name: 'alpha', releaseDate: '2023-01-01' }],
      ['b', { name: 'beta',  releaseDate: '2024-06-01' }],
      ['c', { name: 'gamma', releaseDate: '2022-03-15' }],
    ]);
    const sorted = sortResults(map);
    assert.equal(sorted[0].name, 'beta');
    assert.equal(sorted[1].name, 'alpha');
    assert.equal(sorted[2].name, 'gamma');
  });

  it('breaks ties alphabetically by name', () => {
    const map = new Map([
      ['b', { name: 'beta',  releaseDate: '2024-01-01' }],
      ['a', { name: 'alpha', releaseDate: '2024-01-01' }],
    ]);
    const sorted = sortResults(map);
    assert.equal(sorted[0].name, 'alpha');
    assert.equal(sorted[1].name, 'beta');
  });

  it('sinks "unknown" release dates to the bottom', () => {
    const map = new Map([
      ['a', { name: 'alpha',   releaseDate: 'unknown' }],
      ['b', { name: 'beta',    releaseDate: '2024-01-01' }],
      ['c', { name: 'gamma',   releaseDate: '2023-06-01' }],
    ]);
    const sorted = sortResults(map);
    assert.equal(sorted[2].name, 'alpha');
  });

  it('sorts multiple "unknown" entries alphabetically among themselves', () => {
    const map = new Map([
      ['b', { name: 'zeta',  releaseDate: 'unknown' }],
      ['a', { name: 'alpha', releaseDate: 'unknown' }],
      ['c', { name: 'mu',    releaseDate: 'unknown' }],
    ]);
    const sorted = sortResults(map);
    assert.equal(sorted[0].name, 'alpha');
    assert.equal(sorted[1].name, 'mu');
    assert.equal(sorted[2].name, 'zeta');
  });

  it('does not mutate the input Map', async () => {
    const map = new Map([
      ['a', { name: 'alpha', releaseDate: '2023-01-01' }],
      ['b', { name: 'beta',  releaseDate: '2024-01-01' }],
    ]);
    const originalOrder = [...map.values()].map(v => v.name);
    sortResults(map);
    const afterOrder = [...map.values()].map(v => v.name);
    assert.deepEqual(originalOrder, afterOrder);
  });
});


// ── detectEcosystem ────────────────────────────────────────────────────────────
//
// IMPORTANT: detectEcosystem returns null when no recognised files exist at the
// root level. Callers MUST fall back to 'python' in that case (using ?? 'python')
// so that parseGithubDependencies can run its depth-2 traversal and find nested
// dep files such as the manifest.json in Home Assistant integrations located at
// custom_components/<name>/manifest.json.
// Removing that fallback causes HA integration repos to fail with "Could not
// detect ecosystem" even though the dep file is reachable via traversal.

describe('detectEcosystem', () => {
  it('detects npm from package-lock.json', () => {
    const listing = [{ name: 'package-lock.json', type: 'file' }];
    assert.equal(detectEcosystem(listing), 'npm');
  });

  it('detects npm from pnpm-lock.yaml', () => {
    const listing = [{ name: 'pnpm-lock.yaml', type: 'file' }];
    assert.equal(detectEcosystem(listing), 'npm');
  });

  it('detects npm from package.json', () => {
    const listing = [{ name: 'package.json', type: 'file' }];
    assert.equal(detectEcosystem(listing), 'npm');
  });

  it('npm takes precedence over python when both present', () => {
    const listing = [
      { name: 'package.json',  type: 'file' },
      { name: 'requirements.txt', type: 'file' },
    ];
    assert.equal(detectEcosystem(listing), 'npm');
  });

  it('detects python from pyproject.toml', () => {
    const listing = [{ name: 'pyproject.toml', type: 'file' }];
    assert.equal(detectEcosystem(listing), 'python');
  });

  it('detects python from requirements.txt', () => {
    const listing = [{ name: 'requirements.txt', type: 'file' }];
    assert.equal(detectEcosystem(listing), 'python');
  });

  it('detects python from manifest.json', () => {
    const listing = [{ name: 'manifest.json', type: 'file' }];
    assert.equal(detectEcosystem(listing), 'python');
  });

  it('detects python from setup.cfg', () => {
    const listing = [{ name: 'setup.cfg', type: 'file' }];
    assert.equal(detectEcosystem(listing), 'python');
  });

  it('detects python from Pipfile', () => {
    const listing = [{ name: 'Pipfile', type: 'file' }];
    assert.equal(detectEcosystem(listing), 'python');
  });

  // ── HA regression guard ──────────────────────────────────────────────────
  // A Home Assistant integration repo has manifest.json at
  // custom_components/<name>/manifest.json — two levels below the repo root.
  // detectEcosystem only sees the root listing, so it must return null here.
  // The CALLER must apply ?? 'python' so that parseGithubDependencies runs
  // its depth-2 traversal and finds the nested manifest.json.
  // If this test starts failing the fallback may have been removed.

  it('returns null for a HA-style root listing (only custom_components dir)', () => {
    const listing = [
      { name: 'custom_components', type: 'dir' },
      { name: 'README.md',         type: 'file' },
      { name: '.github',           type: 'dir' },
    ];
    assert.equal(detectEcosystem(listing), null);
  });

  it('returns null for an empty listing', () => {
    assert.equal(detectEcosystem([]), null);
  });

  it('returns null when only unrecognised files and dirs are present', () => {
    const listing = [
      { name: 'src',       type: 'dir' },
      { name: 'README.md', type: 'file' },
      { name: 'LICENSE',   type: 'file' },
    ];
    assert.equal(detectEcosystem(listing), null);
  });
});
