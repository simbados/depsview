/**
 * Pure Python dependency-string parsers — no Node.js imports.
 * This module is intentionally free of `node:fs`, `node:path`, and any other
 * Node-only API so it can be imported unchanged in a browser context as well
 * as in Node.js. File-system operations (reading files, resolving -r includes)
 * live in parser.js which wraps this module for CLI use.
 */

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
 * Extracts dependency strings from a TOML array literal (may be multiline).
 * Reads all quoted strings from the text and parses each as a dependency.
 * Returns a new array rather than mutating a caller-supplied accumulator.
 * @param {string} text - TOML array text, e.g. `[ "requests>=2.0", "click" ]`
 * @returns {Array<{ name: string, versionSpec: string|null }>}
 */
function extractTomlArrayDeps(text) {
  const deps = [];
  for (const m of text.matchAll(/["']([^"']+)["']/g)) {
    const dep = parseDependencyString(m[1]);
    if (dep) deps.push(dep);
  }
  return deps;
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
      deps.push(...extractTomlArrayDeps(arrayLines.join('\n')));
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
          deps.push(...extractTomlArrayDeps(after));
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

export { parseDependencyString, parseRequiresDist, parsePyprojectToml, parseSetupCfg, parsePipfile, parseManifestJson };
