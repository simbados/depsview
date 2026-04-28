/**
 * Tests for src/parser.js.
 * Covers parseDependencyString, parseRequiresDist, and parseDependencyFile
 * against every fixture format and version-constraint syntax.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDependencyFile, parseRequiresDist, parseDependencyString } from '../src/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, 'fixtures');

// ── parseDependencyString ─────────────────────────────────────────────────────

describe('parseDependencyString', () => {
  /**
   * Verifies that an exact-version pin (==) is parsed into name and full spec.
   */
  test('parses exact version pin (==)', () => {
    const result = parseDependencyString('requests==2.31.0');
    assert.deepEqual(result, { name: 'requests', versionSpec: '==2.31.0' });
  });

  /**
   * Verifies that a minimum-version constraint (>=) is preserved in the spec.
   */
  test('parses minimum version (>=)', () => {
    const result = parseDependencyString('requests>=2.28.0');
    assert.deepEqual(result, { name: 'requests', versionSpec: '>=2.28.0' });
  });

  /**
   * Verifies that a multi-constraint spec (>=,<) is kept as a single string.
   */
  test('parses version range (>=,<)', () => {
    const result = parseDependencyString('requests>=2.28.0,<3.0.0');
    assert.deepEqual(result, { name: 'requests', versionSpec: '>=2.28.0,<3.0.0' });
  });

  /**
   * Verifies that a compatible-release operator (~=) is preserved unchanged.
   */
  test('parses compatible release (~=)', () => {
    const result = parseDependencyString('click~=8.1');
    assert.deepEqual(result, { name: 'click', versionSpec: '~=8.1' });
  });

  /**
   * Verifies that an exclusion combined with a minimum bound (!=,>=) is kept whole.
   */
  test('parses exclusion with lower bound (!=,>=)', () => {
    const result = parseDependencyString('requests!=2.29.0,>=2.28.0');
    assert.deepEqual(result, { name: 'requests', versionSpec: '!=2.29.0,>=2.28.0' });
  });

  /**
   * Verifies that extras notation like requests[security] has the bracket part stripped
   * from the name while the version spec is preserved.
   */
  test('strips extras from package name', () => {
    const result = parseDependencyString('requests[security]>=2.28.0');
    assert.deepEqual(result, { name: 'requests', versionSpec: '>=2.28.0' });
  });

  /**
   * Verifies that a package name with extras but no version returns null versionSpec.
   */
  test('strips extras when no version is given', () => {
    const result = parseDependencyString('click[testing]');
    assert.deepEqual(result, { name: 'click', versionSpec: null });
  });

  /**
   * Verifies that a bare package name with no version constraint returns null versionSpec.
   */
  test('returns null versionSpec for bare package name', () => {
    const result = parseDependencyString('requests');
    assert.deepEqual(result, { name: 'requests', versionSpec: null });
  });

  /**
   * Verifies that PyPI-style parenthesised version specs are unwrapped correctly.
   */
  test('strips surrounding parentheses from version spec', () => {
    const result = parseDependencyString('requests (>=2.28.0)');
    assert.deepEqual(result, { name: 'requests', versionSpec: '>=2.28.0' });
  });

  /**
   * Verifies that a URL-style dependency (git+https://...) returns null and is skipped.
   */
  test('returns null for git URL dependency', () => {
    const result = parseDependencyString('git+https://github.com/org/repo.git');
    assert.equal(result, null);
  });

  /**
   * Verifies that a local-path dependency (./pkg) returns null and is skipped.
   */
  test('returns null for local path dependency', () => {
    const result = parseDependencyString('./local-package');
    assert.equal(result, null);
  });

  /**
   * Verifies that a package name containing dots (common in the Python ecosystem) is accepted.
   */
  test('accepts package names with dots (e.g. zope.interface)', () => {
    const result = parseDependencyString('zope.interface>=5.0');
    assert.deepEqual(result, { name: 'zope.interface', versionSpec: '>=5.0' });
  });
});

// ── parseRequiresDist ─────────────────────────────────────────────────────────

describe('parseRequiresDist', () => {
  /**
   * Verifies that the PyPI parenthesised format "name (>=version)" is unwrapped.
   */
  test('parses parenthesised spec from PyPI', () => {
    const result = parseRequiresDist('requests (>=2.0)');
    assert.deepEqual(result, { name: 'requests', versionSpec: '>=2.0' });
  });

  /**
   * Verifies that environment markers separated by ";" are stripped and the
   * dependency is still parsed correctly.
   */
  test('strips environment marker after semicolon', () => {
    const result = parseRequiresDist('click>=7.0; python_version >= "3.6"');
    assert.deepEqual(result, { name: 'click', versionSpec: '>=7.0' });
  });

  /**
   * Verifies that an extras-conditional dependency ("; extra == ...") is skipped
   * because it only applies when an optional extras group is installed.
   */
  test('returns null for extras-conditional dependency', () => {
    const result = parseRequiresDist('pytest; extra == "test"');
    assert.equal(result, null);
  });

  /**
   * Verifies that multiple constraints in a requires_dist entry are preserved together.
   */
  test('preserves multiple constraints', () => {
    const result = parseRequiresDist('urllib3!=1.25.0,>=1.21.1');
    assert.deepEqual(result, { name: 'urllib3', versionSpec: '!=1.25.0,>=1.21.1' });
  });

  /**
   * Verifies that null/undefined input returns null without throwing.
   */
  test('returns null for null input', () => {
    assert.equal(parseRequiresDist(null), null);
    assert.equal(parseRequiresDist(undefined), null);
    assert.equal(parseRequiresDist(''), null);
  });
});

// ── parseDependencyFile: requirements.txt fixtures ───────────────────────────

describe('requirements.txt — exact pins', () => {
  /**
   * Reads the req-exact fixture and asserts both packages are parsed with == specs.
   */
  test('detects requirements.txt as source', () => {
    const { source } = parseDependencyFile(path.join(fixtures, 'req-exact'));
    assert.equal(source, 'requirements.txt');
  });

  test('parses requests==2.31.0', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'req-exact'));
    const req = deps.find(d => d.name === 'requests');
    assert.ok(req, 'requests not found in deps');
    assert.equal(req.versionSpec, '==2.31.0');
  });

  test('parses click==8.1.3', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'req-exact'));
    const click = deps.find(d => d.name === 'click');
    assert.ok(click, 'click not found in deps');
    assert.equal(click.versionSpec, '==8.1.3');
  });
});

describe('requirements.txt — version ranges', () => {
  /**
   * Asserts that comma-separated range constraints are preserved as a single string.
   */
  test('parses requests>=2.28.0,<3.0.0', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'req-ranges'));
    const req = deps.find(d => d.name === 'requests');
    assert.ok(req);
    assert.equal(req.versionSpec, '>=2.28.0,<3.0.0');
  });

  test('parses click>=7.0.0,<=8.2.0', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'req-ranges'));
    const click = deps.find(d => d.name === 'click');
    assert.ok(click);
    assert.equal(click.versionSpec, '>=7.0.0,<=8.2.0');
  });
});

describe('requirements.txt — compatible release (~=)', () => {
  /**
   * Asserts that the ~= operator is kept intact for the resolver to evaluate.
   */
  test('parses requests~=2.28.1', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'req-compat'));
    const req = deps.find(d => d.name === 'requests');
    assert.ok(req);
    assert.equal(req.versionSpec, '~=2.28.1');
  });

  test('parses click~=8.1', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'req-compat'));
    const click = deps.find(d => d.name === 'click');
    assert.ok(click);
    assert.equal(click.versionSpec, '~=8.1');
  });
});

describe('requirements.txt — exclusions (!=)', () => {
  /**
   * Asserts that exclusion-plus-lower-bound specs are preserved in full.
   */
  test('parses requests!=2.29.0,>=2.28.0', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'req-exclude'));
    const req = deps.find(d => d.name === 'requests');
    assert.ok(req);
    assert.equal(req.versionSpec, '!=2.29.0,>=2.28.0');
  });

  test('parses click!=8.0.0,>=7.0.0', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'req-exclude'));
    const click = deps.find(d => d.name === 'click');
    assert.ok(click);
    assert.equal(click.versionSpec, '!=8.0.0,>=7.0.0');
  });
});

describe('requirements.txt — extras notation', () => {
  /**
   * Asserts that bracket extras are stripped from the package name.
   */
  test('strips [security] from requests name', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'req-extras'));
    const req = deps.find(d => d.name === 'requests');
    assert.ok(req, 'requests not found after extras strip');
    assert.equal(req.versionSpec, '>=2.28.0');
  });

  test('strips [testing] from click name, versionSpec is null', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'req-extras'));
    const click = deps.find(d => d.name === 'click');
    assert.ok(click, 'click not found after extras strip');
    assert.equal(click.versionSpec, null);
  });
});

describe('requirements.txt — no version constraint', () => {
  /**
   * Asserts that bare package names produce a null versionSpec (meaning "use latest").
   */
  test('requests with no version has null versionSpec', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'req-noversion'));
    const req = deps.find(d => d.name === 'requests');
    assert.ok(req);
    assert.equal(req.versionSpec, null);
  });

  test('click with no version has null versionSpec', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'req-noversion'));
    const click = deps.find(d => d.name === 'click');
    assert.ok(click);
    assert.equal(click.versionSpec, null);
  });
});

describe('requirements.txt — comments and blank lines', () => {
  /**
   * Asserts that inline comments (#) and blank lines are ignored and do not produce
   * phantom entries. Only the two real packages should appear.
   */
  test('yields exactly 2 deps despite comments and blank lines', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'req-comments'));
    assert.equal(deps.length, 2);
  });

  test('inline comment does not pollute version spec', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'req-comments'));
    const req = deps.find(d => d.name === 'requests');
    assert.ok(req);
    assert.equal(req.versionSpec, '>=2.28.0');
  });
});

// ── parseDependencyFile: pyproject.toml PEP 621 ───────────────────────────────

describe('pyproject.toml — PEP 621 [project] dependencies', () => {
  /**
   * Asserts that [project].dependencies is parsed and [project.optional-dependencies]
   * (dev extras) is ignored.
   */
  test('detects pyproject.toml as source', () => {
    const { source } = parseDependencyFile(path.join(fixtures, 'pyproject-pep621'));
    assert.equal(source, 'pyproject.toml');
  });

  test('returns exactly 2 deps (optional-dependencies excluded)', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'pyproject-pep621'));
    assert.equal(deps.length, 2);
  });

  test('parses requests>=2.28.0,<3.0.0', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'pyproject-pep621'));
    const req = deps.find(d => d.name === 'requests');
    assert.ok(req);
    assert.equal(req.versionSpec, '>=2.28.0,<3.0.0');
  });

  test('parses click==8.1.3', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'pyproject-pep621'));
    const click = deps.find(d => d.name === 'click');
    assert.ok(click);
    assert.equal(click.versionSpec, '==8.1.3');
  });
});

// ── parseDependencyFile: pyproject.toml Poetry ───────────────────────────────

describe('pyproject.toml — Poetry [tool.poetry.dependencies]', () => {
  /**
   * Asserts that the python version entry is excluded and ^ is normalised to >=.
   */
  test('excludes the python version entry', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'pyproject-poetry'));
    const python = deps.find(d => d.name === 'python');
    assert.equal(python, undefined);
  });

  test('returns exactly 2 deps', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'pyproject-poetry'));
    assert.equal(deps.length, 2);
  });

  test('normalises Poetry ^ to >= for requests', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'pyproject-poetry'));
    const req = deps.find(d => d.name === 'requests');
    assert.ok(req);
    assert.equal(req.versionSpec, '>=2.28.0');
  });

  test('preserves standard PEP 440 spec for click', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'pyproject-poetry'));
    const click = deps.find(d => d.name === 'click');
    assert.ok(click);
    assert.equal(click.versionSpec, '>=8.0.0,<9.0.0');
  });
});

// ── parseDependencyFile: setup.cfg ───────────────────────────────────────────

describe('setup.cfg — [options] install_requires', () => {
  /**
   * Asserts that multiline install_requires entries are all collected.
   */
  test('detects setup.cfg as source', () => {
    const { source } = parseDependencyFile(path.join(fixtures, 'setup-cfg'));
    assert.equal(source, 'setup.cfg');
  });

  test('parses requests>=2.28.0', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'setup-cfg'));
    const req = deps.find(d => d.name === 'requests');
    assert.ok(req);
    assert.equal(req.versionSpec, '>=2.28.0');
  });

  test('parses click==8.1.3', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'setup-cfg'));
    const click = deps.find(d => d.name === 'click');
    assert.ok(click);
    assert.equal(click.versionSpec, '==8.1.3');
  });
});

// ── parseDependencyFile: Pipfile ──────────────────────────────────────────────

describe('Pipfile — [packages]', () => {
  /**
   * Asserts that [packages] entries are parsed and [dev-packages] are not included.
   */
  test('detects Pipfile as source', () => {
    const { source } = parseDependencyFile(path.join(fixtures, 'pipfile'));
    assert.equal(source, 'Pipfile');
  });

  test('returns exactly 2 deps ([dev-packages] excluded)', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'pipfile'));
    assert.equal(deps.length, 2);
  });

  test('parses requests with >= spec', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'pipfile'));
    const req = deps.find(d => d.name === 'requests');
    assert.ok(req);
    assert.equal(req.versionSpec, '>=2.28.0');
  });

  test('parses click "*" as null versionSpec', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'pipfile'));
    const click = deps.find(d => d.name === 'click');
    assert.ok(click);
    assert.equal(click.versionSpec, null);
  });
});

// ── parseDependencyFile: manifest.json (Home Assistant) ──────────────────────

describe('manifest.json — exact pins', () => {
  /**
   * Asserts that manifest.json is detected as the source file and that exact-version
   * entries in `requirements` are parsed correctly.
   */
  test('detects manifest.json as source', () => {
    const { source } = parseDependencyFile(path.join(fixtures, 'manifest-exact'));
    assert.equal(source, 'manifest.json');
  });

  test('returns exactly 2 deps', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'manifest-exact'));
    assert.equal(deps.length, 2);
  });

  test('parses requests==2.31.0', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'manifest-exact'));
    const req = deps.find(d => d.name === 'requests');
    assert.ok(req);
    assert.equal(req.versionSpec, '==2.31.0');
  });

  test('parses click==8.1.3', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'manifest-exact'));
    const click = deps.find(d => d.name === 'click');
    assert.ok(click);
    assert.equal(click.versionSpec, '==8.1.3');
  });
});

describe('manifest.json — version ranges', () => {
  /**
   * Asserts that comma-separated range constraints inside a JSON string are preserved.
   */
  test('parses requests>=2.28.0,<3.0.0', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'manifest-ranges'));
    const req = deps.find(d => d.name === 'requests');
    assert.ok(req);
    assert.equal(req.versionSpec, '>=2.28.0,<3.0.0');
  });

  test('parses click>=7.0.0,<=8.2.0', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'manifest-ranges'));
    const click = deps.find(d => d.name === 'click');
    assert.ok(click);
    assert.equal(click.versionSpec, '>=7.0.0,<=8.2.0');
  });
});

describe('manifest.json — no version constraint', () => {
  /**
   * Asserts that bare package names in the requirements array produce null versionSpec.
   */
  test('requests with no version has null versionSpec', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'manifest-noversion'));
    const req = deps.find(d => d.name === 'requests');
    assert.ok(req);
    assert.equal(req.versionSpec, null);
  });

  test('click with no version has null versionSpec', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'manifest-noversion'));
    const click = deps.find(d => d.name === 'click');
    assert.ok(click);
    assert.equal(click.versionSpec, null);
  });
});

describe('manifest.json — empty requirements', () => {
  /**
   * Asserts that an empty requirements array returns zero deps without errors.
   * HA integrations that use only built-in Python libraries have no requirements.
   */
  test('returns 0 deps for empty requirements array', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'manifest-empty'));
    assert.equal(deps.length, 0);
  });

  test('still detects manifest.json as source when requirements is empty', () => {
    const { source } = parseDependencyFile(path.join(fixtures, 'manifest-empty'));
    assert.equal(source, 'manifest.json');
  });
});

describe('manifest.json — non-requirements fields ignored', () => {
  /**
   * Asserts that HA-specific top-level fields (domain, name, codeowners, etc.)
   * are not treated as dependencies.
   */
  test('domain and name are not parsed as deps', () => {
    const { deps } = parseDependencyFile(path.join(fixtures, 'manifest-exact'));
    const domain = deps.find(d => d.name === 'domain' || d.name === 'test_integration');
    assert.equal(domain, undefined);
  });
});

// ── parseDependencyFile: error handling ──────────────────────────────────────

describe('parseDependencyFile — error handling', () => {
  /**
   * Asserts that a directory with no recognised dependency file throws an error
   * with a descriptive message listing the files it looked for.
   */
  test('throws when no dependency file is found', () => {
    // __dirname is the test/ directory — it contains only .js files and fixtures/,
    // none of which match the four filenames parseDependencyFile looks for.
    assert.throws(
      () => parseDependencyFile(__dirname),
      /No dependency file found/
    );
  });
});
