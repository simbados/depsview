import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry, sleep } from '../../src/util/http.js';

/** Stores the original fetch so each test can restore it. */
let origFetch;
beforeEach(() => { origFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = origFetch; });

/** Helper: creates a single-use fetch mock that returns a fixed response. */
function mockFetch(response) {
  globalThis.fetch = async () => response;
}

/** Helper: creates a fetch mock that returns each element of `responses` in order. */
function mockFetchSequence(responses) {
  let i = 0;
  globalThis.fetch = async () => responses[i++];
}

describe('sleep', () => {
  it('resolves after approximately the given delay', async () => {
    const start = Date.now();
    await sleep(20);
    assert.ok(Date.now() - start >= 15);
  });
});

describe('fetchWithRetry — success', () => {
  it('returns parsed JSON on 200', async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ name: 'lodash' }), headers: { get: () => null } });
    const result = await fetchWithRetry('https://pypi.org/pypi/lodash/json', { serviceName: 'test' });
    assert.deepEqual(result, { name: 'lodash' });
  });
});

describe('fetchWithRetry — 404', () => {
  it('returns null regardless of throwOnError', async () => {
    for (const throwOnError of [true, false]) {
      mockFetch({ ok: false, status: 404, headers: { get: () => null } });
      const result = await fetchWithRetry('https://pypi.org/pypi/nonexistent/json', { serviceName: 'test', throwOnError });
      assert.equal(result, null);
    }
  });
});

describe('fetchWithRetry — non-ok response (throwOnError=true)', () => {
  it('throws on 500', async () => {
    mockFetch({ ok: false, status: 500, headers: { get: () => null } });
    await assert.rejects(
      () => fetchWithRetry('https://pypi.org/pypi/pkg/json', { serviceName: 'MyService', throwOnError: true }),
      /MyService returned HTTP 500/
    );
  });
});

describe('fetchWithRetry — non-ok response (throwOnError=false)', () => {
  it('returns null on 500', async () => {
    mockFetch({ ok: false, status: 500, headers: { get: () => null } });
    const result = await fetchWithRetry('https://pypi.org/pypi/pkg/json', { serviceName: 'test', throwOnError: false });
    assert.equal(result, null);
  });
});

describe('fetchWithRetry — 429 retry then success', () => {
  it('retries after 429 and returns result on next success', async () => {
    mockFetchSequence([
      { ok: false, status: 429, headers: { get: () => '0' } },
      { ok: true,  status: 200, json: async () => ({ ok: true }), headers: { get: () => null } },
    ]);
    const result = await fetchWithRetry('https://pypi.org/pypi/pkg/json', { serviceName: 'test', retryBaseMs: 0 });
    assert.deepEqual(result, { ok: true });
  });
});

describe('fetchWithRetry — 429 exhausted (throwOnError=true)', () => {
  it('throws after all retries are exhausted', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, headers: { get: () => '0' } });
    await assert.rejects(
      () => fetchWithRetry('https://pypi.org/pypi/pkg/json', { serviceName: 'MyService', throwOnError: true, maxRetries: 2, retryBaseMs: 0 }),
      /Rate limited by MyService/
    );
  });
});

describe('fetchWithRetry — 429 exhausted (throwOnError=false)', () => {
  it('returns null after all retries are exhausted', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, headers: { get: () => '0' } });
    const result = await fetchWithRetry('https://pypi.org/pypi/pkg/json', { serviceName: 'test', throwOnError: false, maxRetries: 2, retryBaseMs: 0 });
    assert.equal(result, null);
  });
});

describe('fetchWithRetry — network error (throwOnError=true)', () => {
  it('throws after all retries fail with network error', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    await assert.rejects(
      () => fetchWithRetry('https://pypi.org/pypi/pkg/json', { serviceName: 'test', throwOnError: true, maxRetries: 2, retryBaseMs: 0 }),
      /Network error fetching/
    );
  });
});

describe('fetchWithRetry — network error (throwOnError=false)', () => {
  it('returns null after all retries fail with network error', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const result = await fetchWithRetry('https://pypi.org/pypi/pkg/json', { serviceName: 'test', throwOnError: false, maxRetries: 2, retryBaseMs: 0 });
    assert.equal(result, null);
  });
});
