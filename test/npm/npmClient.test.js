import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPackageInfo, getVersionList, getReleaseDate, getFirstReleaseDate, getReleaseCount, _clearCache } from '../../src/npm/npmClient.js';

/** Builds a minimal npm registry document. */
function makePackageDoc({ name = 'lodash', versions = ['4.17.21'], created = '2012-03-09T00:00:00.000Z' } = {}) {
  const time = { created, modified: '2024-01-01T00:00:00.000Z' };
  const versionDocs = {};
  for (const v of versions) {
    time[v] = `2021-${String(versions.indexOf(v) + 1).padStart(2, '0')}-01T00:00:00.000Z`;
    versionDocs[v] = { name, version: v };
  }
  return { name, versions: versionDocs, time };
}

beforeEach(() => _clearCache());

describe('getVersionList', () => {
  it('returns all version strings', () => {
    const doc = makePackageDoc({ versions: ['1.0.0', '2.0.0', '3.0.0'] });
    assert.deepEqual(getVersionList(doc).sort(), ['1.0.0', '2.0.0', '3.0.0']);
  });

  it('returns empty array for null input', () => {
    assert.deepEqual(getVersionList(null), []);
  });
});

describe('getReleaseDate', () => {
  it('returns YYYY-MM-DD for a known version', () => {
    const doc = makePackageDoc({ versions: ['4.17.21'] });
    assert.equal(getReleaseDate(doc, '4.17.21'), '2021-01-01');
  });

  it('returns "unknown" for a version not in time object', () => {
    const doc = makePackageDoc({ versions: ['4.17.21'] });
    assert.equal(getReleaseDate(doc, '9.9.9'), 'unknown');
  });
});

describe('getFirstReleaseDate', () => {
  it('returns date from time.created', () => {
    const doc = makePackageDoc({ created: '2012-03-09T22:04:48.515Z' });
    assert.equal(getFirstReleaseDate(doc), '2012-03-09');
  });

  it('falls back to earliest version timestamp when created is absent', () => {
    const doc = makePackageDoc({ versions: ['1.0.0', '2.0.0'] });
    delete doc.time.created;
    const result = getFirstReleaseDate(doc);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(result));
  });

  it('returns "unknown" when time object is absent', () => {
    assert.equal(getFirstReleaseDate({}), 'unknown');
  });
});

describe('getReleaseCount', () => {
  it('counts the number of versions', () => {
    const doc = makePackageDoc({ versions: ['1.0.0', '1.1.0', '2.0.0'] });
    assert.equal(getReleaseCount(doc), 3);
  });

  it('returns 0 for null input', () => {
    assert.equal(getReleaseCount(null), 0);
  });
});

describe('fetchPackageInfo — mocked fetch', () => {
  it('returns parsed JSON on success', async () => {
    const doc = makePackageDoc({ name: 'lodash' });
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => doc });
    try {
      const result = await fetchPackageInfo('lodash');
      assert.equal(result.name, 'lodash');
    } finally {
      globalThis.fetch = orig;
      _clearCache();
    }
  });

  it('returns null on 404', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    try {
      assert.equal(await fetchPackageInfo('nonexistent-pkg-xyz'), null);
    } finally {
      globalThis.fetch = orig;
      _clearCache();
    }
  });

  it('caches result so fetch is only called once', async () => {
    const doc = makePackageDoc({ name: 'lodash' });
    let callCount = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = async () => { callCount++; return { ok: true, status: 200, json: async () => doc }; };
    try {
      await fetchPackageInfo('lodash');
      await fetchPackageInfo('lodash');
      assert.equal(callCount, 1);
    } finally {
      globalThis.fetch = orig;
      _clearCache();
    }
  });

  it('encodes scoped package name in URL', async () => {
    let capturedUrl = '';
    const orig = globalThis.fetch;
    globalThis.fetch = async (url) => { capturedUrl = url; return { ok: false, status: 404 }; };
    try {
      await fetchPackageInfo('@babel/core');
      assert.ok(capturedUrl.includes('@babel%2Fcore'), `URL was: ${capturedUrl}`);
    } finally {
      globalThis.fetch = orig;
      _clearCache();
    }
  });
});
