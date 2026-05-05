import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDependencies } from '../../src/npm/depResolver.js';
import { _clearCache } from '../../src/npm/npmClient.js';

afterEach(() => _clearCache());

/** Creates a minimal npm registry document for mocking. */
function makeDoc(name, version, deps = {}) {
  return {
    name,
    versions: {
      [version]: { name, version, dependencies: deps },
    },
    time: {
      created:  '2020-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      [version]: '2021-06-01T00:00:00.000Z',
    },
  };
}

/** Sets up a globalThis.fetch mock that returns docs by package name. */
function mockFetch(docs) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    for (const [name, doc] of Object.entries(docs)) {
      const encoded = name.startsWith('@') ? name.replace('/', '%2F') : name;
      if (url.includes(encoded)) {
        return { ok: true, status: 200, json: async () => doc };
      }
    }
    return { ok: false, status: 404 };
  };
  return () => { globalThis.fetch = orig; };
}

describe('resolveDependencies — lock file path (exact versions)', () => {
  it('detects lock file path when input has version property', async () => {
    const restore = mockFetch({ lodash: makeDoc('lodash', '4.17.21') });
    try {
      const results = await resolveDependencies([{ name: 'lodash', version: '4.17.21' }]);
      assert.ok(results.has('lodash@4.17.21'));
      assert.equal(results.get('lodash@4.17.21').version, '4.17.21');
    } finally { restore(); }
  });

  it('stores npm link in result', async () => {
    const restore = mockFetch({ lodash: makeDoc('lodash', '4.17.21') });
    try {
      const results = await resolveDependencies([{ name: 'lodash', version: '4.17.21' }]);
      assert.equal(results.get('lodash@4.17.21').link, 'https://www.npmjs.com/package/lodash');
    } finally { restore(); }
  });

  it('marks package as not-found on 404', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    try {
      const results = await resolveDependencies([{ name: 'nonexistent', version: '1.0.0' }]);
      assert.ok(results.get('nonexistent@1.0.0').error);
    } finally { globalThis.fetch = orig; }
  });

  it('resolves multiple packages in parallel', async () => {
    const restore = mockFetch({
      lodash: makeDoc('lodash', '4.17.21'),
      vite:   makeDoc('vite',   '5.1.0'),
    });
    try {
      const results = await resolveDependencies([
        { name: 'lodash', version: '4.17.21' },
        { name: 'vite',   version: '5.1.0'   },
      ]);
      assert.equal(results.size, 2);
    } finally { restore(); }
  });

  it('returns empty Map for empty input', async () => {
    const results = await resolveDependencies([]);
    assert.equal(results.size, 0);
  });
});

describe('resolveDependencies — package.json path (semver ranges)', () => {
  it('detects range path when input has versionSpec property', async () => {
    const restore = mockFetch({ lodash: makeDoc('lodash', '4.17.21') });
    try {
      const results = await resolveDependencies([{ name: 'lodash', versionSpec: '^4.0.0' }]);
      assert.ok(results.has('lodash'));
    } finally { restore(); }
  });

  it('resolves transitive dependencies', async () => {
    const restore = mockFetch({
      vite:   makeDoc('vite',   '5.1.0', { lodash: '^4.0.0' }),
      lodash: makeDoc('lodash', '4.17.21'),
    });
    try {
      const results = await resolveDependencies([{ name: 'vite', versionSpec: '^5.0.0' }]);
      assert.ok(results.has('vite'));
      assert.ok(results.has('lodash'));
    } finally { restore(); }
  });

  it('handles cycles without infinite loop', async () => {
    const restore = mockFetch({
      a: makeDoc('a', '1.0.0', { b: '^1.0.0' }),
      b: makeDoc('b', '1.0.0', { a: '^1.0.0' }),
    });
    try {
      const results = await resolveDependencies([{ name: 'a', versionSpec: '1.0.0' }]);
      assert.ok(results.has('a'));
      assert.ok(results.has('b'));
    } finally { restore(); }
  });

  it('calls onProgress for each resolved package', async () => {
    const restore = mockFetch({ lodash: makeDoc('lodash', '4.17.21') });
    const msgs = [];
    try {
      await resolveDependencies(
        [{ name: 'lodash', versionSpec: '^4.0.0' }],
        { onProgress: m => msgs.push(m) }
      );
      assert.ok(msgs.some(m => m.includes('lodash')));
    } finally { restore(); }
  });
});
