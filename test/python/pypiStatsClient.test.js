/**
 * Tests for src/pypiStatsClient.js.
 * fetch is replaced with a mock before each test and restored afterwards.
 * _clearCache() is called before every test so cached results from one test
 * cannot bleed into another.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchDownloadStats, _clearCache } from '../../src/python/pypiStatsClient.js';

/** Saves the real global fetch so we can restore it after each test. */
const realFetch = globalThis.fetch;

/**
 * Replaces globalThis.fetch with a mock that returns each response in the
 * provided array in order. After the array is exhausted the last entry repeats.
 * An entry with a `throw` property causes the mock to throw that value instead
 * of returning a response.
 * @param {Array<{ status: number, body?: object, headers?: object, throw?: Error }>} responses
 * @returns {{ callCount: () => number }} helper to assert how many times fetch was called
 */
function mockFetch(responses) {
  let calls = 0;
  globalThis.fetch = async () => {
    const entry = responses[Math.min(calls, responses.length - 1)];
    calls++;
    if (entry.throw) throw entry.throw;
    return {
      ok: entry.status >= 200 && entry.status < 300,
      status: entry.status,
      headers: { get: (h) => entry.headers?.[h] ?? null },
      json: async () => entry.body,
    };
  };
  return { callCount: () => calls };
}

/**
 * Restores the real fetch and clears the module cache before every test so
 * each test runs against a clean slate.
 */
beforeEach(() => {
  globalThis.fetch = realFetch;
  _clearCache();
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('fetchDownloadStats — successful response', () => {
  /**
   * A well-formed 200 response should return { lastMonth } with the correct value.
   */
  test('returns lastMonth from a valid response', async () => {
    mockFetch([{
      status: 200,
      body: { data: { last_day: 1000, last_week: 7000, last_month: 34567890 }, package: 'requests' },
    }]);
    const result = await fetchDownloadStats('requests');
    assert.deepEqual(result, { lastMonth: 34567890 });
  });

  /**
   * Package names are normalized (uppercase, underscores) before the request,
   * and the result should still be returned correctly.
   */
  test('normalizes package name before fetching', async () => {
    const { callCount } = mockFetch([{
      status: 200,
      body: { data: { last_day: 1, last_week: 7, last_month: 999 }, package: 'my-pkg' },
    }]);
    const result = await fetchDownloadStats('My_Pkg');
    assert.deepEqual(result, { lastMonth: 999 });
    assert.equal(callCount(), 1);
  });
});

// ── Null / missing data ───────────────────────────────────────────────────────

describe('fetchDownloadStats — missing or null data', () => {
  /**
   * When last_month is null in the response body, the function should return null
   * rather than { lastMonth: null }.
   */
  test('returns null when last_month is null in response', async () => {
    mockFetch([{
      status: 200,
      body: { data: { last_day: null, last_week: null, last_month: null } },
    }]);
    const result = await fetchDownloadStats('sparse-pkg');
    assert.equal(result, null);
  });

  /**
   * A response body without a `data` field should return null, not throw.
   */
  test('returns null when response body has no data field', async () => {
    mockFetch([{ status: 200, body: { package: 'weird-pkg' } }]);
    const result = await fetchDownloadStats('weird-pkg');
    assert.equal(result, null);
  });
});

// ── HTTP error handling ───────────────────────────────────────────────────────

describe('fetchDownloadStats — HTTP errors', () => {
  /**
   * A 404 means the package has no stats on pypistats.org — return null, not an error.
   */
  test('returns null on 404', async () => {
    mockFetch([{ status: 404 }]);
    const result = await fetchDownloadStats('nonexistent-pkg');
    assert.equal(result, null);
  });

  /**
   * A 500 or other server error should be swallowed and return null so that
   * a pypistats.org outage does not crash the tool.
   */
  test('returns null on 500 server error', async () => {
    mockFetch([{ status: 500 }]);
    const result = await fetchDownloadStats('error-pkg');
    assert.equal(result, null);
  });

  /**
   * A network-level throw (e.g. DNS failure, connection refused) should be
   * caught and return null after all retries are exhausted.
   */
  test('returns null on network error', async () => {
    mockFetch([
      { throw: new Error('connect ECONNREFUSED') },
      { throw: new Error('connect ECONNREFUSED') },
      { throw: new Error('connect ECONNREFUSED') },
    ]);
    const result = await fetchDownloadStats('offline-pkg');
    assert.equal(result, null);
  });

  /**
   * On a 429 rate-limit response the client should retry. If all retries are
   * exhausted it should return null rather than throw.
   */
  test('returns null when all retries are rate-limited (429)', async () => {
    mockFetch([
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
    ]);
    const result = await fetchDownloadStats('ratelimited-pkg');
    assert.equal(result, null);
  });

  /**
   * On a 429 followed by a successful response the client should retry and
   * return the stats from the successful attempt.
   */
  test('retries after 429 and returns result on success', async () => {
    mockFetch([
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, body: { data: { last_day: 1, last_week: 7, last_month: 5000 } } },
    ]);
    const result = await fetchDownloadStats('retry-ok-pkg');
    assert.deepEqual(result, { lastMonth: 5000 });
  });
});

// ── Caching ───────────────────────────────────────────────────────────────────

describe('fetchDownloadStats — caching', () => {
  /**
   * Calling fetchDownloadStats twice for the same package should only issue
   * one HTTP request; the second call returns the cached value.
   */
  test('returns cached result on second call without re-fetching', async () => {
    const { callCount } = mockFetch([{
      status: 200,
      body: { data: { last_day: 1, last_week: 7, last_month: 12345 } },
    }]);
    await fetchDownloadStats('cached-pkg');
    const second = await fetchDownloadStats('cached-pkg');
    assert.equal(callCount(), 1);
    assert.deepEqual(second, { lastMonth: 12345 });
  });

  /**
   * A null result (e.g. from a 404) is also cached so that the second call
   * does not retry the request.
   */
  test('caches null results to avoid redundant retries', async () => {
    const { callCount } = mockFetch([{ status: 404 }]);
    await fetchDownloadStats('null-cached-pkg');
    const second = await fetchDownloadStats('null-cached-pkg');
    assert.equal(callCount(), 1);
    assert.equal(second, null);
  });

  /**
   * _clearCache() should remove all cached entries so the next call issues
   * a fresh HTTP request.
   */
  test('_clearCache allows re-fetching after cache is cleared', async () => {
    const { callCount } = mockFetch([
      { status: 200, body: { data: { last_day: 1, last_week: 7, last_month: 1 } } },
      { status: 200, body: { data: { last_day: 1, last_week: 7, last_month: 2 } } },
    ]);
    await fetchDownloadStats('clearable-pkg');
    _clearCache();
    await fetchDownloadStats('clearable-pkg');
    assert.equal(callCount(), 2);
  });
});
