import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseGithubDependencies, resolvePath, mergeDeps } from '../src/githubParser.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Encodes a plain string as base64, as the GitHub Contents API does for file bodies.
 * @param {string} str
 * @returns {string}
 */
function b64(str) {
  return Buffer.from(str).toString('base64');
}

/**
 * Builds a GitHub Contents API file response object.
 * @param {string} content - raw file text to encode
 * @returns {{ content: string, encoding: string }}
 */
function fileBody(content) {
  return { content: b64(content), encoding: 'base64' };
}

/**
 * Builds a directory listing entry.
 * @param {string} name
 * @param {'file'|'dir'} type
 * @param {string} path
 */
function entry(name, type, path) {
  return { name, type, path };
}

/**
 * Creates a fetch mock that routes requests by exact URL.
 * Any URL not found in the routes map returns a 404.
 * @param {Record<string, unknown>} routes - URL → response body
 * @returns {(url: string) => Promise<object>}
 */
function makeRouter(routes) {
  return async (url) => {
    const body = routes[url];
    if (body !== undefined) {
      return { status: 200, ok: true, headers: { get: () => null }, json: async () => body };
    }
    return { status: 404, ok: false, headers: { get: () => null }, json: async () => ({ message: 'Not Found' }) };
  };
}

const API = 'https://api.github.com/repos/owner/repo/contents';

// ── resolvePath ───────────────────────────────────────────────────────────────

describe('resolvePath', () => {
  it('joins a simple filename onto a base directory', () => {
    assert.equal(resolvePath('src', 'other.txt'), 'src/other.txt');
  });

  it('resolves a parent-directory segment', () => {
    assert.equal(resolvePath('src', '../requirements.txt'), 'requirements.txt');
  });

  it('resolves multiple parent-directory segments', () => {
    assert.equal(resolvePath('a/b/c', '../../file.txt'), 'a/file.txt');
  });

  it('treats a leading ./ as current directory', () => {
    assert.equal(resolvePath('src', './file.txt'), 'src/file.txt');
  });

  it('works when the base is empty (repo root)', () => {
    assert.equal(resolvePath('', 'requirements.txt'), 'requirements.txt');
  });

  it('handles a multi-segment include path', () => {
    assert.equal(resolvePath('src', 'deps/base.txt'), 'src/deps/base.txt');
  });
});

// ── mergeDeps ─────────────────────────────────────────────────────────────────

describe('mergeDeps', () => {
  it('passes through a single package unchanged', () => {
    const result = mergeDeps([{ name: 'requests', versionSpec: '>=2.28.0' }]);
    assert.deepEqual(result, [{ name: 'requests', versionSpec: '>=2.28.0' }]);
  });

  it('deduplicates the same package by normalised name', () => {
    const result = mergeDeps([
      { name: 'requests', versionSpec: '>=2.28.0' },
      { name: 'requests', versionSpec: '>=2.28.0' },
    ]);
    assert.equal(result.length, 1);
  });

  it('combines version specs from duplicate entries with a comma', () => {
    const result = mergeDeps([
      { name: 'requests', versionSpec: '>=2.28.0' },
      { name: 'requests', versionSpec: '<3.0.0' },
    ]);
    assert.equal(result[0].versionSpec, '>=2.28.0,<3.0.0');
  });

  it('preserves the first occurrence name casing', () => {
    const result = mergeDeps([
      { name: 'Requests', versionSpec: null },
      { name: 'requests', versionSpec: '>=2.0' },
    ]);
    assert.equal(result[0].name, 'Requests');
  });

  it('treats hyphen, underscore and dot as equivalent when deduplicating', () => {
    const result = mergeDeps([
      { name: 'my-package', versionSpec: '>=1.0' },
      { name: 'my_package', versionSpec: '<2.0' },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].versionSpec, '>=1.0,<2.0');
  });

  it('adopts a new versionSpec when the existing one is null', () => {
    const result = mergeDeps([
      { name: 'requests', versionSpec: null },
      { name: 'requests', versionSpec: '>=2.28.0' },
    ]);
    assert.equal(result[0].versionSpec, '>=2.28.0');
  });

  it('keeps null when both entries have no spec', () => {
    const result = mergeDeps([
      { name: 'requests', versionSpec: null },
      { name: 'requests', versionSpec: null },
    ]);
    assert.equal(result[0].versionSpec, null);
  });

  it('preserves package order (first appearance wins the slot)', () => {
    const result = mergeDeps([
      { name: 'click', versionSpec: null },
      { name: 'requests', versionSpec: null },
    ]);
    assert.equal(result[0].name, 'click');
    assert.equal(result[1].name, 'requests');
  });
});

// ── parseGithubDependencies ───────────────────────────────────────────────────

describe('parseGithubDependencies — dep file at root level', () => {
  afterEach(() => { delete globalThis.fetch; });

  it('finds and parses requirements.txt at the repo root', async () => {
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [entry('requirements.txt', 'file', 'requirements.txt')],
      [`${API}/requirements.txt?ref=HEAD`]: fileBody('requests==2.31.0\nclick==8.1.7\n'),
    });
    const { deps } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    assert.equal(deps.length, 2);
    assert.ok(deps.some(d => d.name === 'requests'));
    assert.ok(deps.some(d => d.name === 'click'));
  });

  it('returns the source as the dep filename', async () => {
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [entry('requirements.txt', 'file', 'requirements.txt')],
      [`${API}/requirements.txt?ref=HEAD`]: fileBody('requests\n'),
    });
    const { source } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    assert.ok(source.includes('requirements.txt'));
  });

  it('parses pyproject.toml at the root', async () => {
    const content = '[project]\ndependencies = [\n  "requests>=2.28.0",\n  "click==8.1.7",\n]\n';
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [entry('pyproject.toml', 'file', 'pyproject.toml')],
      [`${API}/pyproject.toml?ref=HEAD`]: fileBody(content),
    });
    const { deps } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    assert.ok(deps.some(d => d.name === 'requests'));
    assert.ok(deps.some(d => d.name === 'click'));
  });

  it('uses the specified ref in all API requests', async () => {
    const capturedUrls = [];
    globalThis.fetch = async (url) => {
      capturedUrls.push(url);
      if (url.includes('?ref=v2.0')) {
        return { status: 200, ok: true, headers: { get: () => null },
          json: async () => url.includes('/requirements.txt')
            ? fileBody('requests\n')
            : [entry('requirements.txt', 'file', 'requirements.txt')]
        };
      }
      return { status: 404, ok: false, headers: { get: () => null }, json: async () => ({}) };
    };
    await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'v2.0', subpath: '' });
    assert.ok(capturedUrls.every(u => u.includes('ref=v2.0')));
  });
});

describe('parseGithubDependencies — two-level-deep traversal', () => {
  afterEach(() => { delete globalThis.fetch; });

  it('finds a manifest.json two directory levels below the starting path', async () => {
    const manifest = JSON.stringify({ requirements: ['requests==2.31.0'] });
    globalThis.fetch = makeRouter({
      // root has no dep files, only a subdirectory
      [`${API}?ref=HEAD`]: [entry('custom_components', 'dir', 'custom_components')],
      // level-1 dir has no dep files, only a subdirectory
      [`${API}/custom_components?ref=HEAD`]: [entry('myintegration', 'dir', 'custom_components/myintegration')],
      // level-2 dir has manifest.json
      [`${API}/custom_components/myintegration?ref=HEAD`]: [
        entry('manifest.json', 'file', 'custom_components/myintegration/manifest.json'),
      ],
      [`${API}/custom_components/myintegration/manifest.json?ref=HEAD`]: fileBody(manifest),
    });
    const { deps } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    assert.equal(deps.length, 1);
    assert.equal(deps[0].name, 'requests');
  });

  it('does not traverse beyond two levels deep', async () => {
    // A dep file exists at level 3 — it must not appear in results
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [entry('a', 'dir', 'a')],
      [`${API}/a?ref=HEAD`]: [entry('b', 'dir', 'a/b')],
      [`${API}/a/b?ref=HEAD`]: [entry('c', 'dir', 'a/b/c')],
      // level-3 dir — should never be listed
      [`${API}/a/b/c?ref=HEAD`]: [entry('requirements.txt', 'file', 'a/b/c/requirements.txt')],
      [`${API}/a/b/c/requirements.txt?ref=HEAD`]: fileBody('requests\n'),
    });
    await assert.rejects(
      () => parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' }),
      /No dependency file found/
    );
  });

  it('collects dep files from both the root and a subdirectory', async () => {
    const manifest = JSON.stringify({ requirements: ['click==8.1.7'] });
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [
        entry('requirements.txt', 'file', 'requirements.txt'),
        entry('custom_components', 'dir', 'custom_components'),
      ],
      [`${API}/requirements.txt?ref=HEAD`]: fileBody('requests==2.31.0\n'),
      [`${API}/custom_components?ref=HEAD`]: [
        entry('myintegration', 'dir', 'custom_components/myintegration'),
      ],
      [`${API}/custom_components/myintegration?ref=HEAD`]: [
        entry('manifest.json', 'file', 'custom_components/myintegration/manifest.json'),
      ],
      [`${API}/custom_components/myintegration/manifest.json?ref=HEAD`]: fileBody(manifest),
    });
    const { deps } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    assert.ok(deps.some(d => d.name === 'requests'));
    assert.ok(deps.some(d => d.name === 'click'));
  });
});

describe('parseGithubDependencies — multi-file merge', () => {
  afterEach(() => { delete globalThis.fetch; });

  it('parses all dep files found in the same directory', async () => {
    const pyproject = '[project]\ndependencies = ["requests>=2.28.0"]\n';
    const setup = '[options]\ninstall_requires =\n    click==8.1.7\n';
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [
        entry('pyproject.toml', 'file', 'pyproject.toml'),
        entry('setup.cfg', 'file', 'setup.cfg'),
      ],
      [`${API}/pyproject.toml?ref=HEAD`]: fileBody(pyproject),
      [`${API}/setup.cfg?ref=HEAD`]: fileBody(setup),
    });
    const { deps } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    assert.ok(deps.some(d => d.name === 'requests'));
    assert.ok(deps.some(d => d.name === 'click'));
  });

  it('merges version specs when the same package appears in multiple files', async () => {
    const pyproject = '[project]\ndependencies = ["requests>=2.28.0"]\n';
    const reqs = 'requests<3.0.0\n';
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [
        entry('pyproject.toml', 'file', 'pyproject.toml'),
        entry('requirements.txt', 'file', 'requirements.txt'),
      ],
      [`${API}/pyproject.toml?ref=HEAD`]: fileBody(pyproject),
      [`${API}/requirements.txt?ref=HEAD`]: fileBody(reqs),
    });
    const { deps } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    const req = deps.find(d => d.name === 'requests');
    assert.ok(req, 'requests should be in deps');
    assert.ok(req.versionSpec.includes('>=2.28.0'), `got: ${req.versionSpec}`);
    assert.ok(req.versionSpec.includes('<3.0.0'),   `got: ${req.versionSpec}`);
  });

  it('source lists all parsed file paths', async () => {
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [
        entry('requirements.txt', 'file', 'requirements.txt'),
        entry('setup.cfg', 'file', 'setup.cfg'),
      ],
      [`${API}/requirements.txt?ref=HEAD`]: fileBody('requests\n'),
      [`${API}/setup.cfg?ref=HEAD`]: fileBody('[options]\ninstall_requires =\n    click\n'),
    });
    const { source } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    assert.ok(source.includes('requirements.txt'));
    assert.ok(source.includes('setup.cfg'));
  });
});

describe('parseGithubDependencies — requirements.txt -r includes', () => {
  afterEach(() => { delete globalThis.fetch; });

  it('resolves a -r include relative to the requirements file', async () => {
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [entry('requirements.txt', 'file', 'requirements.txt')],
      [`${API}/requirements.txt?ref=HEAD`]: fileBody('-r base.txt\n'),
      [`${API}/base.txt?ref=HEAD`]: fileBody('requests==2.31.0\n'),
    });
    const { deps } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    assert.ok(deps.some(d => d.name === 'requests'));
  });

  it('silently skips a -r include that does not exist', async () => {
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [entry('requirements.txt', 'file', 'requirements.txt')],
      [`${API}/requirements.txt?ref=HEAD`]: fileBody('-r missing.txt\nclick\n'),
      // missing.txt returns 404 (not in routes)
    });
    const { deps } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    assert.ok(deps.some(d => d.name === 'click'));
    assert.equal(deps.find(d => d.name === 'missing'), undefined);
  });
});

describe('parseGithubDependencies — security: circular -r includes', () => {
  afterEach(() => { delete globalThis.fetch; });

  it('does not loop on a self-referencing -r include', async () => {
    // requirements.txt includes itself — without a visited guard this recurses forever
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [entry('requirements.txt', 'file', 'requirements.txt')],
      [`${API}/requirements.txt?ref=HEAD`]: fileBody('-r requirements.txt\nrequests\n'),
    });
    const { deps } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    assert.ok(deps.some(d => d.name === 'requests'));
  });

  it('does not loop on a two-file circular include chain (A includes B includes A)', async () => {
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [entry('requirements.txt', 'file', 'requirements.txt')],
      [`${API}/requirements.txt?ref=HEAD`]: fileBody('-r b.txt\nrequests\n'),
      [`${API}/b.txt?ref=HEAD`]: fileBody('-r requirements.txt\nclick\n'),
    });
    const { deps } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    assert.ok(deps.some(d => d.name === 'requests'));
    assert.ok(deps.some(d => d.name === 'click'));
  });
});

describe('parseGithubDependencies — test directory filtering', () => {
  afterEach(() => { delete globalThis.fetch; });

  it('skips a "tests" subdirectory by default', async () => {
    const manifest = JSON.stringify({ requirements: ['pytest==8.0.0'] });
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [
        entry('requirements.txt', 'file', 'requirements.txt'),
        entry('tests', 'dir', 'tests'),
      ],
      [`${API}/requirements.txt?ref=HEAD`]: fileBody('requests==2.31.0\n'),
      // If tests/ were traversed it would expose pytest
      [`${API}/tests?ref=HEAD`]: [entry('manifest.json', 'file', 'tests/manifest.json')],
      [`${API}/tests/manifest.json?ref=HEAD`]: fileBody(manifest),
    });
    const { deps } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    assert.ok(deps.some(d => d.name === 'requests'), 'prod dep should be present');
    assert.ok(!deps.some(d => d.name === 'pytest'), 'test dep from tests/ must be absent by default');
  });

  it('includes a "tests" subdirectory when includeTests is true', async () => {
    const manifest = JSON.stringify({ requirements: ['pytest==8.0.0'] });
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [
        entry('requirements.txt', 'file', 'requirements.txt'),
        entry('tests', 'dir', 'tests'),
      ],
      [`${API}/requirements.txt?ref=HEAD`]: fileBody('requests==2.31.0\n'),
      [`${API}/tests?ref=HEAD`]: [entry('manifest.json', 'file', 'tests/manifest.json')],
      [`${API}/tests/manifest.json?ref=HEAD`]: fileBody(manifest),
    });
    const { deps } = await parseGithubDependencies(
      { owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' },
      { includeTests: true }
    );
    assert.ok(deps.some(d => d.name === 'requests'), 'prod dep should be present');
    assert.ok(deps.some(d => d.name === 'pytest'), 'test dep from tests/ should be present with includeTests');
  });

  it('skips an "e2e" subdirectory by default', async () => {
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [
        entry('requirements.txt', 'file', 'requirements.txt'),
        entry('e2e', 'dir', 'e2e'),
      ],
      [`${API}/requirements.txt?ref=HEAD`]: fileBody('requests==2.31.0\n'),
      [`${API}/e2e?ref=HEAD`]: [entry('requirements.txt', 'file', 'e2e/requirements.txt')],
      [`${API}/e2e/requirements.txt?ref=HEAD`]: fileBody('selenium\n'),
    });
    const { deps } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    assert.ok(!deps.some(d => d.name === 'selenium'), 'e2e dep must be absent by default');
  });
});

describe('parseGithubDependencies — test requirements file filtering', () => {
  afterEach(() => { delete globalThis.fetch; });

  it('skips a -r requirements-test.txt include by default', async () => {
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [entry('requirements.txt', 'file', 'requirements.txt')],
      [`${API}/requirements.txt?ref=HEAD`]: fileBody('-r requirements-test.txt\nrequests==2.31.0\n'),
      [`${API}/requirements-test.txt?ref=HEAD`]: fileBody('pytest\n'),
    });
    const { deps } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    assert.ok(deps.some(d => d.name === 'requests'), 'prod dep should be present');
    assert.ok(!deps.some(d => d.name === 'pytest'), 'pytest from test include must be absent by default');
  });

  it('includes a -r requirements-test.txt when includeTests is true', async () => {
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [entry('requirements.txt', 'file', 'requirements.txt')],
      [`${API}/requirements.txt?ref=HEAD`]: fileBody('-r requirements-test.txt\nrequests==2.31.0\n'),
      [`${API}/requirements-test.txt?ref=HEAD`]: fileBody('pytest\n'),
    });
    const { deps } = await parseGithubDependencies(
      { owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' },
      { includeTests: true }
    );
    assert.ok(deps.some(d => d.name === 'pytest'), 'pytest should be present with includeTests');
  });

  it('skips a -r dev-requirements.txt include by default', async () => {
    globalThis.fetch = makeRouter({
      [`${API}?ref=HEAD`]: [entry('requirements.txt', 'file', 'requirements.txt')],
      [`${API}/requirements.txt?ref=HEAD`]: fileBody('-r dev-requirements.txt\nrequests\n'),
      [`${API}/dev-requirements.txt?ref=HEAD`]: fileBody('black\n'),
    });
    const { deps } = await parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' });
    assert.ok(!deps.some(d => d.name === 'black'), 'dev dep must be absent by default');
  });
});

describe('parseGithubDependencies — error handling', () => {
  afterEach(() => { delete globalThis.fetch; });

  it('throws when the target directory does not exist', async () => {
    globalThis.fetch = async () => ({
      status: 404, ok: false, headers: { get: () => null }, json: async () => ({}),
    });
    await assert.rejects(
      () => parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: 'nonexistent' }),
      /Directory not found/
    );
  });

  it('throws when no dependency files are found anywhere in the traversed tree', async () => {
    globalThis.fetch = makeRouter({
      // root has only a non-dep file and no subdirs
      [`${API}?ref=HEAD`]: [entry('README.md', 'file', 'README.md')],
    });
    await assert.rejects(
      () => parseGithubDependencies({ owner: 'owner', repo: 'repo', ref: 'HEAD', subpath: '' }),
      /No dependency file found/
    );
  });
});
