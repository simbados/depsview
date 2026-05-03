import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isGithubUrl, parseGithubUrl } from '../../src/github/url.js';

describe('isGithubUrl', () => {
  it('returns true for a plain https github.com URL', () => {
    assert.equal(isGithubUrl('https://github.com/owner/repo'), true);
  });

  it('returns true for an http github.com URL', () => {
    assert.equal(isGithubUrl('http://github.com/owner/repo'), true);
  });

  it('returns false for gitlab.com', () => {
    assert.equal(isGithubUrl('https://gitlab.com/owner/repo'), false);
  });

  it('returns false for a local filesystem path', () => {
    assert.equal(isGithubUrl('/home/user/project'), false);
  });

  it('returns false for a relative path', () => {
    assert.equal(isGithubUrl('./myproject'), false);
  });

  it('returns false for null', () => {
    assert.equal(isGithubUrl(null), false);
  });

  it('returns false for an empty string', () => {
    assert.equal(isGithubUrl(''), false);
  });
});

describe('parseGithubUrl — plain repo URL', () => {
  it('extracts owner and repo', () => {
    const { owner, repo } = parseGithubUrl('https://github.com/foo/bar');
    assert.equal(owner, 'foo');
    assert.equal(repo, 'bar');
  });

  it('defaults ref to HEAD', () => {
    const { ref } = parseGithubUrl('https://github.com/foo/bar');
    assert.equal(ref, 'HEAD');
  });

  it('defaults subpath to empty string', () => {
    const { subpath } = parseGithubUrl('https://github.com/foo/bar');
    assert.equal(subpath, '');
  });

  it('strips .git suffix from repo name', () => {
    const { repo } = parseGithubUrl('https://github.com/foo/bar.git');
    assert.equal(repo, 'bar');
  });

  it('handles a trailing slash', () => {
    const { owner, repo } = parseGithubUrl('https://github.com/foo/bar/');
    assert.equal(owner, 'foo');
    assert.equal(repo, 'bar');
  });
});

describe('parseGithubUrl — /tree/ segment', () => {
  it('extracts ref when only a branch is given', () => {
    const { ref, subpath } = parseGithubUrl('https://github.com/foo/bar/tree/main');
    assert.equal(ref, 'main');
    assert.equal(subpath, '');
  });

  it('extracts ref and single-level subpath', () => {
    const { ref, subpath } = parseGithubUrl('https://github.com/foo/bar/tree/main/subfolder');
    assert.equal(ref, 'main');
    assert.equal(subpath, 'subfolder');
  });

  it('extracts ref and multi-segment subpath', () => {
    const { ref, subpath } = parseGithubUrl('https://github.com/foo/bar/tree/develop/a/b/c');
    assert.equal(ref, 'develop');
    assert.equal(subpath, 'a/b/c');
  });

  it('works with a version tag as ref', () => {
    const { ref, subpath } = parseGithubUrl('https://github.com/foo/bar/tree/v1.2.3/src');
    assert.equal(ref, 'v1.2.3');
    assert.equal(subpath, 'src');
  });
});

describe('parseGithubUrl — error handling', () => {
  it('throws on a non-GitHub URL', () => {
    assert.throws(() => parseGithubUrl('https://gitlab.com/foo/bar'), /Not a valid GitHub/);
  });

  it('throws on a plain string', () => {
    assert.throws(() => parseGithubUrl('not-a-url'), /Not a valid GitHub/);
  });

  it('throws on a URL missing the repo segment', () => {
    assert.throws(() => parseGithubUrl('https://github.com/foo'), /Not a valid GitHub/);
  });
});
