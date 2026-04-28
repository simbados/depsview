/**
 * Parses Python project dependency files and PyPI requires_dist strings.
 * Supports requirements.txt, pyproject.toml, setup.cfg, and Pipfile.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isTestRequirementsFile } from './testFilter.js';

/**
 * Normalizes a Poetry-style version constraint to a PEP 440-compatible specifier.
 * Maps `^X.Y` to `>=X.Y` (close enough for resolution purposes) and `~X.Y` to `~=X.Y`.
 * @param {string} spec - raw Poetry version constraint
 * @returns {string|null} PEP 440 specifier string, or null if it means "any version"
 */
function normalizePoetrySpec(spec) {
  const s = spec.trim();
  if (!s || s === '*') return null;
  if (s.startsWith('^')) return `>=${s.slice(1)}`;
  if (s.startsWith('~') && !s.startsWith('~=')) return `~=${s.slice(1)}`;
  return s;
}

/**
 * Parses a single PEP 508 dependency string into a name + version spec pair.
 * Strips extras (`[security]`), environment markers (`;python_version>=...`), and
 * surrounding parentheses around the version spec.
 * @param {string} depStr - raw dependency string, e.g. "requests>=2.0", "click (>=7.0)"
 * @returns {{ name: string, versionSpec: string|null }|null} parsed dep, or null if unparseable / should skip
 */
function parseDependencyString(depStr) {
  if (!depStr || typeof depStr !== 'string') return null;

  const trimmed = depStr.trim();
  if (!trimmed) return null;

  // Skip URLs and local paths
  if (/^(https?:|git\+|file:|\.\/|\.\.\/|\/)/i.test(trimmed)) return null;

  // Strip extras like [security] or [socks]
  const noExtras = trimmed.replace(/\[[^\]]*\]/g, '');

  // Match package name (PEP 508: starts with letter/digit, may contain ._-)
  const nameMatch = noExtras.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*/);
  if (!nameMatch) return null;

  const name = nameMatch[1];
  let rest = noExtras.slice(nameMatch[0].length).trim();

  // Strip wrapping parentheses: "requests (>=2.0)" → ">=2.0"
  if (rest.startsWith('(') && rest.endsWith(')')) {
    rest = rest.slice(1, -1).trim();
  }

  return { name, versionSpec: rest || null };
}

/**
 * Parses a PEP 508 requires_dist entry from PyPI into a { name, versionSpec } pair.
 * Returns null for extras-conditional dependencies (e.g. `pytest; extra == "test"`)
 * and for environment markers that restrict to optional contexts.
 * @param {string} dep - raw requires_dist string from PyPI JSON API
 * @returns {{ name: string, versionSpec: string|null }|null}
 */
function parseRequiresDist(dep) {
  if (!dep || typeof dep !== 'string') return null;

  const semicolonIdx = dep.indexOf(';');
  const depPart = semicolonIdx !== -1 ? dep.slice(0, semicolonIdx) : dep;
  const markerPart = semicolonIdx !== -1 ? dep.slice(semicolonIdx + 1) : '';

  // Skip dependencies that only apply when an optional extra is installed
  if (markerPart && /extra\s*==/.test(markerPart)) return null;

  return parseDependencyString(depPart);
}

/**
 * Parses a requirements.txt file into a list of dependencies.
 * Handles inline comments, blank lines, `-r` file includes (recursively),
 * and common flags that should be ignored (`-i`, `--index-url`, `-c`, `-e`, etc.).
 *
 * Security guards on `-r` includes:
 *   - Path traversal: the resolved include path must start with `projectRoot`.
 *     Includes that escape the project directory (e.g. `-r ../../../etc/shadow`)
 *     are silently skipped.
 *   - Circular includes: `visited` tracks every absolute path already parsed in
 *     this chain. A file that has already been visited is silently skipped,
 *     preventing infinite recursion from self-referencing or A→B→A cycles.
 *
 * @param {string} content      - file content string
 * @param {string} filePath     - absolute path to this file (used to resolve `-r` includes)
 * @param {string} projectRoot  - absolute path to the project root; includes that resolve
 *                                outside this directory are skipped
 * @param {Set<string>} visited - absolute paths already parsed in this include chain
 * @param {boolean} includeTests - when false (default), -r includes whose filename contains
 *                                 a test-related keyword are silently skipped
 * @returns {Array<{ name: string, versionSpec: string|null }>}
 */
function parseRequirementsTxt(content, filePath, projectRoot, visited = new Set(), includeTests = false) {
  visited.add(filePath);
  const deps = [];
  const dir = path.dirname(filePath);

  for (let line of content.split('\n')) {
    // Strip inline comments
    line = line.split('#')[0].trim();
    // Handle line continuation
    while (line.endsWith('\\')) line = line.slice(0, -1).trim();
    if (!line) continue;

    // Recurse into included files: -r other.txt or --requirement other.txt
    if (/^(-r|--requirement)\s+/.test(line)) {
      const includePath = line.replace(/^(-r|--requirement)\s+/, '').trim();

      // Skip test requirement includes unless the caller opted in
      if (!includeTests && isTestRequirementsFile(path.basename(includePath))) continue;

      const fullPath = path.resolve(dir, includePath);

      // Security: skip includes that escape the project root (path traversal guard)
      if (projectRoot && !fullPath.startsWith(projectRoot + path.sep) && fullPath !== projectRoot) continue;

      // Security: skip already-visited files (circular include guard)
      if (visited.has(fullPath)) continue;

      try {
        const includeContent = fs.readFileSync(fullPath, 'utf8');
        deps.push(...parseRequirementsTxt(includeContent, fullPath, projectRoot, visited, includeTests));
      } catch { /* missing include — skip silently */ }
      continue;
    }

    // Skip all other option flags and editable installs
    if (/^-/.test(line)) continue;

    const dep = parseDependencyString(line);
    if (dep) deps.push(dep);
  }

  return deps;
}

/**
 * Extracts dependency strings from a TOML array literal (may be multiline).
 * Reads all quoted strings from the text and parses each as a dependency.
 * @param {string} text - TOML array text, e.g. `[ "requests>=2.0", "click" ]`
 * @param {Array<{ name: string, versionSpec: string|null }>} out - accumulator array
 */
function extractTomlArrayDeps(text, out) {
  for (const m of text.matchAll(/["']([^"']+)["']/g)) {
    const dep = parseDependencyString(m[1]);
    if (dep) out.push(dep);
  }
}

/**
 * Parses a pyproject.toml file for runtime dependencies.
 * Supports PEP 621 `[project] dependencies` arrays and Poetry
 * `[tool.poetry.dependencies]` key-value tables (skipping optional deps).
 * When includeTests is true, also parses `[tool.poetry.dev-dependencies]` and
 * `[tool.poetry.group.<name>.dependencies]` sections.
 * Does NOT require a full TOML parser — uses a line-by-line state machine.
 * @param {string} content - raw file content
 * @param {boolean} includeTests - when true, dev and group dependency sections are
 *   also parsed in addition to the main dependencies section
 * @returns {Array<{ name: string, versionSpec: string|null }>}
 */
function parsePyprojectToml(content, includeTests = false) {
  const deps = [];
  const lines = content.split('\n');
  let section = '';
  let inDepsArray = false;
  let arrayLines = [];

  const flushArray = () => {
    if (arrayLines.length > 0) {
      extractTomlArrayDeps(arrayLines.join('\n'), deps);
      arrayLines = [];
    }
    inDepsArray = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Section header like [project], [[tool.poetry.dependencies]], etc.
    const sectionMatch = line.match(/^\[+([^\]]+)\]+/);
    if (sectionMatch) {
      if (inDepsArray) flushArray();
      section = sectionMatch[1].trim();
      continue;
    }

    // Collect lines inside a multiline array
    if (inDepsArray) {
      arrayLines.push(rawLine);
      if (line.includes(']')) flushArray();
      continue;
    }

    // ── PEP 621: [project] ──────────────────────────────────────────────────
    if (section === 'project' && /^dependencies\s*=/.test(line)) {
      const after = line.slice(line.indexOf('=') + 1).trim();
      if (after.startsWith('[')) {
        if (after.includes(']')) {
          extractTomlArrayDeps(after, deps);
        } else {
          inDepsArray = true;
          arrayLines = [after];
        }
      }
      continue;
    }

    // ── Poetry: [tool.poetry.dependencies] and, when includeTests, dev/group sections
    const isPoetryDeps = section === 'tool.poetry.dependencies'
      || (includeTests && (
        section === 'tool.poetry.dev-dependencies'
        || /^tool\.poetry\.group\.[^.]+\.dependencies$/.test(section)
      ));
    if (isPoetryDeps) {
      if (line.startsWith('#') || !line.includes('=')) continue;
      const eqIdx = line.indexOf('=');
      const pkgName = line.slice(0, eqIdx).trim();
      if (!pkgName || pkgName === 'python') continue;

      const value = line.slice(eqIdx + 1).trim();

      if (value.startsWith('"') || value.startsWith("'")) {
        const raw = value.replace(/^["']|["']$/g, '');
        const spec = normalizePoetrySpec(raw);
        deps.push({ name: pkgName, versionSpec: spec });
        continue;
      }

      if (value.startsWith('{')) {
        // Inline table: {version = "^1.0", optional = true}
        if (/optional\s*=\s*true/i.test(value)) continue; // skip optional deps
        const vm = value.match(/version\s*=\s*["']([^"']+)["']/);
        const spec = vm ? normalizePoetrySpec(vm[1]) : null;
        deps.push({ name: pkgName, versionSpec: spec });
      }
    }
  }

  if (inDepsArray) flushArray();
  return deps;
}

/**
 * Parses a setup.cfg file for runtime dependencies listed under `[options] install_requires`.
 * The value is a multi-line list (one dep per line after the `=`).
 * @param {string} content - raw file content
 * @returns {Array<{ name: string, versionSpec: string|null }>}
 */
function parseSetupCfg(content) {
  const deps = [];
  const lines = content.split('\n');
  let inInstallRequires = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Detect any new section header
    if (/^\[.+\]$/.test(line)) {
      inInstallRequires = false;
      continue;
    }

    if (/^install_requires\s*=/.test(line)) {
      inInstallRequires = true;
      // Inline deps on the same line as the key
      const after = line.slice(line.indexOf('=') + 1).trim();
      if (after) {
        const dep = parseDependencyString(after);
        if (dep) deps.push(dep);
      }
      continue;
    }

    if (inInstallRequires) {
      // Continuation lines start with whitespace in setup.cfg
      if (rawLine.match(/^\s+\S/)) {
        const dep = parseDependencyString(line);
        if (dep) deps.push(dep);
      } else {
        inInstallRequires = false;
      }
    }
  }

  return deps;
}

/**
 * Parses a Pipfile (TOML format) for dependencies listed under `[packages]`.
 * Values are either `"*"` (any version), a version string like `">=2.0"`,
 * or an inline table like `{version = ">=2.0", extras = [...]}`.
 * When includeTests is true, `[dev-packages]` entries are also included.
 * @param {string} content - raw file content
 * @param {boolean} includeTests - when true, [dev-packages] is parsed in addition
 *   to [packages]
 * @returns {Array<{ name: string, versionSpec: string|null }>}
 */
function parsePipfile(content, includeTests = false) {
  const deps = [];
  const lines = content.split('\n');
  /**
   * True while the parser is positioned inside a dependency section
   * ([packages], or [dev-packages] when includeTests is true).
   * Lines are only parsed as deps when this flag is set.
   */
  let inDepSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^\[.+\]$/.test(line)) {
      inDepSection = line === '[packages]' || (includeTests && line === '[dev-packages]');
      continue;
    }

    if (!inDepSection || line.startsWith('#') || !line.includes('=')) continue;

    const eqIdx = line.indexOf('=');
    const pkgName = line.slice(0, eqIdx).trim();
    if (!pkgName) continue;

    const value = line.slice(eqIdx + 1).trim();

    if (value.startsWith('"') || value.startsWith("'")) {
      const raw = value.replace(/^["']|["']$/g, '').trim();
      const spec = raw === '*' ? null : raw;
      deps.push({ name: pkgName, versionSpec: spec });
      continue;
    }

    if (value.startsWith('{')) {
      const vm = value.match(/version\s*=\s*["']([^"']+)["']/);
      const spec = vm ? (vm[1] === '*' ? null : vm[1]) : null;
      deps.push({ name: pkgName, versionSpec: spec });
    }
  }

  return deps;
}

/**
 * Parses a Home Assistant integration manifest.json for runtime dependencies.
 * The file is a JSON object; only the `requirements` array is read — all other
 * HA-specific fields (domain, name, codeowners, iot_class, etc.) are ignored.
 * Each entry in `requirements` is a standard pip-format string, so it is passed
 * directly through parseDependencyString.
 * @param {string} content - raw JSON file content
 * @returns {Array<{ name: string, versionSpec: string|null }>}
 */
function parseManifestJson(content) {
  const data = JSON.parse(content);
  const requirements = Array.isArray(data.requirements) ? data.requirements : [];
  return requirements
    .map(r => parseDependencyString(r))
    .filter(Boolean);
}

/**
 * Detects and parses the Python dependency file in a given project directory.
 * Priority order: pyproject.toml → manifest.json → requirements.txt → setup.cfg → Pipfile.
 * Returns the parsed dependencies and a label indicating which file was used.
 * @param {string} projectPath - absolute path to the Python project root
 * @param {{ includeTests?: boolean }} [options] - parsing options
 * @param {boolean} [options.includeTests=false] - when true, test/dev dependencies are
 *   included alongside regular production dependencies
 * @returns {{ deps: Array<{ name: string, versionSpec: string|null }>, source: string }}
 */
function parseDependencyFile(projectPath, options = {}) {
  const { includeTests = false } = options;
  const candidates = [
    {
      file: 'pyproject.toml',
      parse: (c) => parsePyprojectToml(c, includeTests),
    },
    {
      file: 'manifest.json',
      parse: (c) => parseManifestJson(c),
    },
    {
      file: 'requirements.txt',
      parse: (c, fp) => parseRequirementsTxt(c, fp, projectPath, new Set(), includeTests),
    },
    {
      file: 'setup.cfg',
      parse: (c) => parseSetupCfg(c),
    },
    {
      file: 'Pipfile',
      parse: (c) => parsePipfile(c, includeTests),
    },
  ];

  for (const { file, parse } of candidates) {
    const fullPath = path.join(projectPath, file);
    if (!fs.existsSync(fullPath)) continue;
    // Guard against a directory entry matching the filename (e.g. case-insensitive fs)
    if (fs.statSync(fullPath).isDirectory()) continue;
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const deps = parse(content, fullPath);
      return { deps, source: file };
    } catch (err) {
      throw new Error(`Failed to parse ${file}: ${err.message}`);
    }
  }

  const tried = candidates.map(c => c.file).join(', ');
  throw new Error(`No dependency file found in ${projectPath}. Looked for: ${tried}`);
}

export { parseDependencyFile, parseRequiresDist, parseDependencyString, parsePyprojectToml, parseManifestJson, parseSetupCfg, parsePipfile };
