import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSocketScores, buildPurl, parseNdjson } from '../../src/socket/client.js';

let origFetch;
beforeEach(() => { origFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = origFetch; });

/** Returns a fetch mock that responds with the given NDJSON text. */
function mockNdjson(lines) {
  const text = lines.join('\n');
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => text,
    json: async () => { throw new Error('should not call json()'); },
  });
}

/** Returns a fetch mock that responds with a non-ok status. */
function mockError(status) {
  globalThis.fetch = async () => ({
    ok: false,
    status,
    headers: { get: () => null },
    text: async () => '',
  });
}

// ── buildPurl ──────────────────────────────────────────────────────────────────

describe('buildPurl', () => {
  it('builds an npm purl', () => {
    assert.equal(buildPurl('express', '4.19.2', 'npm'), 'pkg:npm/express@4.19.2');
  });

  it('builds a pypi purl', () => {
    assert.equal(buildPurl('requests', '2.28.0', 'pypi'), 'pkg:pypi/requests@2.28.0');
  });

  it('uses a raw @ for scoped npm packages — the socket.dev API expects it unencoded', () => {
    // The API returns namespace:"@clack", name:"core" in its response, confirming
    // it accepts and normalises the raw @ itself. Percent-encoding breaks matching.
    assert.equal(buildPurl('@esbuild/aix-ppc64', '0.21.5', 'npm'), 'pkg:npm/@esbuild/aix-ppc64@0.21.5');
  });
});

// ── parseNdjson ────────────────────────────────────────────────────────────────

describe('parseNdjson', () => {
  it('parses multiple lines', () => {
    const result = parseNdjson('{"a":1}\n{"b":2}');
    assert.deepEqual(result, [{ a: 1 }, { b: 2 }]);
  });

  it('skips empty lines', () => {
    const result = parseNdjson('\n{"a":1}\n\n');
    assert.deepEqual(result, [{ a: 1 }]);
  });

  it('skips malformed lines without throwing', () => {
    const result = parseNdjson('{"a":1}\nnot-json\n{"b":2}');
    assert.deepEqual(result, [{ a: 1 }, { b: 2 }]);
  });

  it('returns empty array for empty string', () => {
    assert.deepEqual(parseNdjson(''), []);
  });
});

// ── fetchSocketScores ──────────────────────────────────────────────────────────

describe('fetchSocketScores — empty input', () => {
  it('returns an empty Map without making a network request', async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; };
    const result = await fetchSocketScores([], 'key', 'org', 'npm');
    assert.equal(called, false);
    assert.equal(result.size, 0);
  });
});

describe('fetchSocketScores — npm success', () => {
  it('returns a Map keyed by name@version with supplyChain score', async () => {
    mockNdjson([
      JSON.stringify({ name: 'eslint', version: '8.57.0', score: { supplyChain: 0.9, overall: 0.5 } }),
      JSON.stringify({ name: 'lodash', version: '4.17.21', score: { supplyChain: 0.75, overall: 0.8 } }),
    ]);
    const result = await fetchSocketScores(
      [{ name: 'eslint', version: '8.57.0' }, { name: 'lodash', version: '4.17.21' }],
      'key', 'org', 'npm'
    );
    assert.equal(result.size, 2);
    assert.equal(result.get('eslint@8.57.0'), 0.9);
    assert.equal(result.get('lodash@4.17.21'), 0.75);
  });

  it('recombines namespace and name for scoped packages', async () => {
    // The socket.dev API splits "@clack/core" into namespace:"@clack", name:"core".
    // The key must be "@clack/core@1.3.0" to match the rest of the codebase.
    mockNdjson([
      JSON.stringify({ namespace: '@clack', name: 'core', version: '1.3.0', score: { supplyChain: 1.0 } }),
    ]);
    const result = await fetchSocketScores(
      [{ name: '@clack/core', version: '1.3.0' }],
      'key', 'org', 'npm'
    );
    assert.equal(result.size, 1);
    assert.equal(result.get('@clack/core@1.3.0'), 1.0);
  });
});

describe('fetchSocketScores — pypi success', () => {
  it('builds pypi purls and returns scores', async () => {
    let capturedBody;
    globalThis.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true, status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ name: 'requests', version: '2.28.0', score: { supplyChain: 0.85 } }),
      };
    };
    const result = await fetchSocketScores(
      [{ name: 'requests', version: '2.28.0' }],
      'key', 'org', 'pypi'
    );
    assert.equal(capturedBody.components[0].purl, 'pkg:pypi/requests@2.28.0');
    assert.equal(result.get('requests@2.28.0'), 0.85);
  });
});

describe('fetchSocketScores — authorization header', () => {
  it('sends Bearer token authorization', async () => {
    let capturedHeaders;
    globalThis.fetch = async (url, opts) => {
      capturedHeaders = opts.headers;
      return {
        ok: true, status: 200,
        headers: { get: () => null },
        text: async () => '',
      };
    };
    await fetchSocketScores([{ name: 'express', version: '4.19.2' }], 'my-api-key', 'org', 'npm');
    assert.equal(capturedHeaders['Authorization'], 'Bearer my-api-key');
  });
});

describe('fetchSocketScores — HTTP error', () => {
  it('returns an empty Map on 401', async () => {
    mockError(401);
    const result = await fetchSocketScores([{ name: 'express', version: '4.19.2' }], 'bad-key', 'org', 'npm');
    assert.equal(result.size, 0);
  });

  it('returns an empty Map on 500', async () => {
    mockError(500);
    const result = await fetchSocketScores([{ name: 'express', version: '4.19.2' }], 'key', 'org', 'npm');
    assert.equal(result.size, 0);
  });
});

describe('fetchSocketScores — missing score fields', () => {
  it('skips entries without score.supplyChain', async () => {
    mockNdjson([
      JSON.stringify({ name: 'pkg-a', version: '1.0.0', score: {} }),
      JSON.stringify({ name: 'pkg-b', version: '2.0.0' }),
      JSON.stringify({ name: 'pkg-c', version: '3.0.0', score: { supplyChain: 0.6 } }),
    ]);
    const result = await fetchSocketScores(
      [{ name: 'pkg-a', version: '1.0.0' }, { name: 'pkg-b', version: '2.0.0' }, { name: 'pkg-c', version: '3.0.0' }],
      'key', 'org', 'npm'
    );
    assert.equal(result.size, 1);
    assert.equal(result.get('pkg-c@3.0.0'), 0.6);
  });
});

describe('fetchSocketScores — network error', () => {
  it('returns an empty Map when fetch throws', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const result = await fetchSocketScores([{ name: 'express', version: '4.19.2' }], 'key', 'org', 'npm');
    assert.equal(result.size, 0);
  });
});

describe('fetchSocketScores — name lowercasing', () => {
  it('lowercases the name in the map key', async () => {
    mockNdjson([
      JSON.stringify({ name: 'MyPkg', version: '1.0.0', score: { supplyChain: 0.7 } }),
    ]);
    const result = await fetchSocketScores([{ name: 'MyPkg', version: '1.0.0' }], 'key', 'org', 'npm');
    assert.ok(result.has('mypkg@1.0.0'));
  });
});
