import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { listDirectory, fetchFileContent, setGithubToken } from '../src/githubClient.js';

/**
 * Builds a minimal Response-shaped object for use as a mocked fetch return value.
 * @param {number} status - HTTP status code
 * @param {unknown} body  - value that json() will resolve to
 * @returns {{ status: number, ok: boolean, headers: object, json: () => Promise<unknown> }}
 */
function mockResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
  };
}

describe('listDirectory', () => {
  /** @type {string|null} */
  let capturedUrl;
  /** @type {Record<string,string>|null} */
  let capturedHeaders;

  beforeEach(() => {
    capturedUrl    = null;
    capturedHeaders = null;
  });

  afterEach(() => {
    delete globalThis.fetch;
    delete process.env.GITHUB_TOKEN;
    setGithubToken(null);
  });

  it('returns the entry array on a 200 response', async () => {
    const entries = [{ name: 'requirements.txt', type: 'file', path: 'requirements.txt' }];
    globalThis.fetch = async (url, opts) => {
      capturedUrl     = url;
      capturedHeaders = opts.headers;
      return mockResponse(200, entries);
    };
    const result = await listDirectory('owner', 'repo', '', 'main');
    assert.deepEqual(result, entries);
  });

  it('builds the correct URL for the repository root', async () => {
    globalThis.fetch = async (url) => { capturedUrl = url; return mockResponse(200, []); };
    await listDirectory('owner', 'repo', '', 'main');
    assert.ok(capturedUrl.includes('/repos/owner/repo/contents?ref=main'), capturedUrl);
  });

  it('builds the correct URL for a subdirectory path', async () => {
    globalThis.fetch = async (url) => { capturedUrl = url; return mockResponse(200, []); };
    await listDirectory('owner', 'repo', 'src/components', 'HEAD');
    assert.ok(capturedUrl.includes('/contents/src/components'), capturedUrl);
  });

  it('returns null on 404', async () => {
    globalThis.fetch = async () => mockResponse(404, { message: 'Not Found' });
    const result = await listDirectory('owner', 'repo', '', 'main');
    assert.equal(result, null);
  });

  it('returns null when the API returns a file object instead of a directory array', async () => {
    globalThis.fetch = async () => mockResponse(200, { name: 'README.md', type: 'file', encoding: 'base64' });
    const result = await listDirectory('owner', 'repo', 'README.md', 'main');
    assert.equal(result, null);
  });

  it('throws on 401 unauthorized', async () => {
    globalThis.fetch = async () => mockResponse(401, { message: 'Bad credentials' });
    await assert.rejects(() => listDirectory('owner', 'repo', '', 'main'), /Unauthorized/);
  });

  it('throws on 403 forbidden', async () => {
    globalThis.fetch = async () => mockResponse(403, { message: 'Forbidden' });
    await assert.rejects(() => listDirectory('owner', 'repo', '', 'main'), /Forbidden/);
  });

  it('throws on an unexpected non-ok status', async () => {
    globalThis.fetch = async () => mockResponse(500, { message: 'Internal Server Error' });
    await assert.rejects(() => listDirectory('owner', 'repo', '', 'main'), /HTTP 500/);
  });

  it('throws on a network error', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    await assert.rejects(() => listDirectory('owner', 'repo', '', 'main'), /Network error/);
  });

  it('includes the Authorization header when GITHUB_TOKEN is set', async () => {
    process.env.GITHUB_TOKEN = 'test-token-abc';
    globalThis.fetch = async (url, opts) => { capturedHeaders = opts.headers; return mockResponse(200, []); };
    await listDirectory('owner', 'repo', '', 'main');
    assert.equal(capturedHeaders['Authorization'], 'Bearer test-token-abc');
  });

  it('omits the Authorization header when GITHUB_TOKEN is not set', async () => {
    delete process.env.GITHUB_TOKEN;
    globalThis.fetch = async (url, opts) => { capturedHeaders = opts.headers; return mockResponse(200, []); };
    await listDirectory('owner', 'repo', '', 'main');
    assert.equal(capturedHeaders['Authorization'], undefined);
  });
});

describe('fetchFileContent', () => {
  afterEach(() => {
    delete globalThis.fetch;
  });

  it('decodes base64 content to a UTF-8 string', async () => {
    const raw = 'requests==2.31.0\nclick==8.1.7\n';
    const b64 = Buffer.from(raw).toString('base64');
    globalThis.fetch = async () => mockResponse(200, { content: b64, encoding: 'base64' });
    const result = await fetchFileContent('owner', 'repo', 'requirements.txt', 'main');
    assert.equal(result, raw);
  });

  it('strips embedded newlines from base64 before decoding (GitHub line-wraps at 60 chars)', async () => {
    const raw = 'requests==2.31.0\n';
    const b64WithNewlines = Buffer.from(raw).toString('base64').replace(/.{10}/g, '$&\n');
    globalThis.fetch = async () => mockResponse(200, { content: b64WithNewlines, encoding: 'base64' });
    const result = await fetchFileContent('owner', 'repo', 'requirements.txt', 'main');
    assert.equal(result, raw);
  });

  it('returns null on 404', async () => {
    globalThis.fetch = async () => mockResponse(404, { message: 'Not Found' });
    const result = await fetchFileContent('owner', 'repo', 'missing.txt', 'main');
    assert.equal(result, null);
  });

  it('returns null when the response encoding is not base64', async () => {
    globalThis.fetch = async () => mockResponse(200, { content: 'hello', encoding: 'utf-8' });
    const result = await fetchFileContent('owner', 'repo', 'file.txt', 'main');
    assert.equal(result, null);
  });

  it('returns null when the response has no content field', async () => {
    globalThis.fetch = async () => mockResponse(200, { message: 'unexpected shape' });
    const result = await fetchFileContent('owner', 'repo', 'file.txt', 'main');
    assert.equal(result, null);
  });

  it('throws on 401 unauthorized', async () => {
    globalThis.fetch = async () => mockResponse(401, { message: 'Bad credentials' });
    await assert.rejects(() => fetchFileContent('owner', 'repo', 'f.txt', 'main'), /Unauthorized/);
  });

  it('throws on 403 forbidden', async () => {
    globalThis.fetch = async () => mockResponse(403, { message: 'Forbidden' });
    await assert.rejects(() => fetchFileContent('owner', 'repo', 'f.txt', 'main'), /Forbidden/);
  });

  it('throws on an unexpected non-ok status', async () => {
    globalThis.fetch = async () => mockResponse(500, {});
    await assert.rejects(() => fetchFileContent('owner', 'repo', 'f.txt', 'main'), /HTTP 500/);
  });

  it('throws on a network error', async () => {
    globalThis.fetch = async () => { throw new Error('ETIMEDOUT'); };
    await assert.rejects(() => fetchFileContent('owner', 'repo', 'f.txt', 'main'), /Network error/);
  });
});

describe('setGithubToken', () => {
  /** @type {Record<string,string>|null} */
  let capturedHeaders;

  afterEach(() => {
    delete globalThis.fetch;
    delete process.env.GITHUB_TOKEN;
    setGithubToken(null);
    capturedHeaders = null;
  });

  /**
   * Setting a token via setGithubToken should include it as the Authorization
   * Bearer header on the next API request, regardless of process.env.
   */
  it('includes the token set via setGithubToken in the Authorization header', async () => {
    setGithubToken('browser-supplied-token');
    globalThis.fetch = async (url, opts) => { capturedHeaders = opts.headers; return { status: 200, ok: true, headers: { get: () => null }, json: async () => [] }; };
    await listDirectory('owner', 'repo', '', 'main');
    assert.equal(capturedHeaders['Authorization'], 'Bearer browser-supplied-token');
  });

  /**
   * The module override should take precedence over GITHUB_TOKEN in process.env
   * so the browser-supplied token wins even when the env var is also present.
   */
  it('override takes precedence over process.env.GITHUB_TOKEN', async () => {
    process.env.GITHUB_TOKEN = 'env-token';
    setGithubToken('override-token');
    globalThis.fetch = async (url, opts) => { capturedHeaders = opts.headers; return { status: 200, ok: true, headers: { get: () => null }, json: async () => [] }; };
    await listDirectory('owner', 'repo', '', 'main');
    assert.equal(capturedHeaders['Authorization'], 'Bearer override-token');
  });

  /**
   * Calling setGithubToken(null) should clear the override so that subsequent
   * requests fall back to the environment variable or no token.
   */
  it('clears the override when called with null', async () => {
    setGithubToken('some-token');
    setGithubToken(null);
    delete process.env.GITHUB_TOKEN;
    globalThis.fetch = async (url, opts) => { capturedHeaders = opts.headers; return { status: 200, ok: true, headers: { get: () => null }, json: async () => [] }; };
    await listDirectory('owner', 'repo', '', 'main');
    assert.equal(capturedHeaders['Authorization'], undefined);
  });

  /**
   * Calling setGithubToken with an empty string should also clear the override.
   */
  it('clears the override when called with an empty string', async () => {
    setGithubToken('some-token');
    setGithubToken('');
    delete process.env.GITHUB_TOKEN;
    globalThis.fetch = async (url, opts) => { capturedHeaders = opts.headers; return { status: 200, ok: true, headers: { get: () => null }, json: async () => [] }; };
    await listDirectory('owner', 'repo', '', 'main');
    assert.equal(capturedHeaders['Authorization'], undefined);
  });
});
