/**
 * Tests for src/depResolver.js.
 * Focuses on the downloadStats option — verifying that pypistats.org is never
 * contacted when downloadStats is false, and that all results carry null for
 * downloadsLastMonth in that case.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDependencies } from '../src/depResolver.js';

/**
 * Builds a minimal PyPI JSON response for a leaf package (no transitive deps).
 * @param {string} name - package name as it would appear in PyPI info.name
 * @param {string} version - version string
 * @returns {object} PyPI-shaped JSON body
 */
function makePypiPackage(name, version) {
  return {
    info: { name, version, requires_dist: [], requires_python: null },
    releases: {
      [version]: [{ upload_time: '2023-05-22T10:00:00' }],
    },
    urls: [{ upload_time: '2023-05-22T10:00:00' }],
  };
}

/**
 * Builds a minimal Response-shaped object for fetch mocking.
 * @param {number} status
 * @param {unknown} body
 */
function mockResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
  };
}

// ── downloadStats: false ──────────────────────────────────────────────────────

describe('resolveDependencies — downloadStats: false (default)', () => {
  afterEach(() => { delete globalThis.fetch; });

  it('does not call pypistats.org when downloadStats is false', async () => {
    const pypistatsUrls = [];
    globalThis.fetch = async (url) => {
      if (url.includes('pypistats.org')) {
        pypistatsUrls.push(url);
        return mockResponse(200, { data: { last_month: 999 } });
      }
      // Unique name avoids colliding with pypiClient's in-memory cache
      if (url.includes('pypi.org')) return mockResponse(200, makePypiPackage('dep-no-stats-a', '1.0.0'));
      return mockResponse(404, {});
    };

    await resolveDependencies([{ name: 'dep-no-stats-a', versionSpec: null }], { downloadStats: false });
    assert.equal(pypistatsUrls.length, 0, 'pypistats.org must not be called when downloadStats is false');
  });

  it('sets downloadsLastMonth to null for all results when downloadStats is false', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('pypi.org')) return mockResponse(200, makePypiPackage('dep-no-stats-b', '1.0.0'));
      return mockResponse(404, {});
    };

    const results = await resolveDependencies(
      [{ name: 'dep-no-stats-b', versionSpec: null }],
      { downloadStats: false }
    );

    for (const result of results.values()) {
      assert.equal(result.downloadsLastMonth, null,
        `downloadsLastMonth should be null without downloadStats, got: ${result.downloadsLastMonth}`);
    }
  });

  it('omits the "Fetching download statistics…" progress message when downloadStats is false', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('pypi.org')) return mockResponse(200, makePypiPackage('dep-no-stats-c', '1.0.0'));
      return mockResponse(404, {});
    };

    const progressMessages = [];
    await resolveDependencies(
      [{ name: 'dep-no-stats-c', versionSpec: null }],
      { downloadStats: false, onProgress: msg => progressMessages.push(msg) }
    );

    assert.ok(
      !progressMessages.some(m => m.includes('download statistics')),
      'No download statistics progress message should appear when downloadStats is false'
    );
  });
});

// ── downloadStats: true ───────────────────────────────────────────────────────

describe('resolveDependencies — downloadStats: true', () => {
  afterEach(() => { delete globalThis.fetch; });

  it('calls pypistats.org and populates downloadsLastMonth when downloadStats is true', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('pypistats.org')) return mockResponse(200, { data: { last_month: 5000000 } });
      if (url.includes('pypi.org'))      return mockResponse(200, makePypiPackage('dep-with-stats-a', '2.0.0'));
      return mockResponse(404, {});
    };

    const results = await resolveDependencies(
      [{ name: 'dep-with-stats-a', versionSpec: null }],
      { downloadStats: true }
    );

    const result = results.get('dep-with-stats-a');
    assert.ok(result, 'result for dep-with-stats-a should exist');
    assert.equal(result.downloadsLastMonth, 5000000);
  });

  it('emits the "Fetching download statistics" progress message when downloadStats is true', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('pypistats.org')) return mockResponse(200, { data: { last_month: 1 } });
      if (url.includes('pypi.org'))      return mockResponse(200, makePypiPackage('dep-with-stats-b', '1.0.0'));
      return mockResponse(404, {});
    };

    const progressMessages = [];
    await resolveDependencies(
      [{ name: 'dep-with-stats-b', versionSpec: null }],
      { downloadStats: true, onProgress: msg => progressMessages.push(msg) }
    );

    assert.ok(
      progressMessages.some(m => m.includes('download statistics')),
      'Progress message about download statistics should appear when downloadStats is true'
    );
  });
});
