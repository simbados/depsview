/**
 * pnpm-lock.yaml parser.
 * Uses a line-based state machine instead of a YAML library to avoid
 * third-party dependencies.  Supports lockfile format versions 5, 6, and 9.
 *
 * Format summary:
 *   v5  (pnpm ≤6)  lockfileVersion: 5.x
 *     packages section key:  /name/version:      (scoped: /@scope/name/version:)
 *     dev flag:              dev: true  inside each entry block
 *
 *   v6  (pnpm 7/8) lockfileVersion: '6.0'
 *     packages section key:  /name@version:      (scoped: /@scope/name@version:)
 *     dev flag:              dev: true  inside each entry block
 *
 *   v9  (pnpm 9+)  lockfileVersion: '9.0'
 *     packages section key:  name@version:       (scoped: @scope/name@version:)
 *     peer-dep suffix:       name@version(peer@x):  — stripped before parsing
 *     dev flag:              absent from packages; read from importers: section instead
 */

/**
 * Parses the package entry key from the packages: section.
 * Handles all three version formats and both plain and scoped names.
 *
 * @param {string} key           - key text with leading/trailing quotes and colon already stripped
 * @param {number} majorVersion  - parsed major version of the lockfile
 * @returns {{ name: string, version: string }|null} null if the key cannot be parsed
 */
function parsePackageKey(key, majorVersion) {
  // Strip leading slash present in v5/v6 but absent in v9
  let s = key.startsWith('/') ? key.slice(1) : key;

  // Strip peer-dep parenthetical suffix: name@1.0.0(peer@2.0.0) → name@1.0.0
  s = s.replace(/\([^)]*\)$/, '');

  if (majorVersion <= 5) {
    // v5: /name/version  or  /@scope/name/version
    // Everything before the last / is the name; everything after is the version.
    const lastSlash = s.lastIndexOf('/');
    if (lastSlash === -1) return null;
    return { name: s.slice(0, lastSlash), version: s.slice(lastSlash + 1) };
  }

  // v6/v9: name@version  or  @scope/name@version
  // The last @ separates name from version.
  // Edge: a bare scoped name like @scope/name with no version has lastAt === 0
  // (the leading @), which is caught by the lastAt <= 0 guard.
  const lastAt = s.lastIndexOf('@');
  if (lastAt <= 0) return null;
  const name    = s.slice(0, lastAt);
  const version = s.slice(lastAt + 1);
  if (!name || !version) return null;
  return { name, version };
}

/**
 * Reads the major version number from a pnpm-lock.yaml file.
 * Returns 6 as a conservative default when the field is absent.
 * @param {string} content - raw pnpm-lock.yaml file content
 * @returns {number}
 */
function getPnpmMajorVersion(content) {
  for (const line of content.split('\n')) {
    const m = line.match(/^lockfileVersion:\s*['"]?(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  return 6;
}

/**
 * Parses a pnpm-lock.yaml file and returns a flat list of installed packages.
 *
 * Algorithm:
 *   1. Detect the lockfile major version from the lockfileVersion: field.
 *   2. Walk the packages: section line by line.
 *      - 2-space-indented lines ending with : are package entry keys.
 *      - 4-space-indented "dev: true" marks a package as dev-only (v5/v6).
 *   3. For v9, walk the importers: section to collect dev dependency names
 *      (the dev: flag does not exist in the packages: section of v9 files).
 *   4. Deduplicate by name@version: the same package at different paths with the
 *      same version is listed once; different versions of the same name are each listed.
 *   5. Filter out dev-only packages unless includeTests is true.
 *
 * flushEntry() is called both inside the loop (when a new entry starts or a new
 * top-level section begins) and once after the loop ends — that final call is
 * necessary because the very last package entry has no subsequent trigger to
 * flush it.
 *
 * @param {string}  content              - raw pnpm-lock.yaml file content
 * @param {boolean} [includeTests=false] - when true, dev packages are included
 * @returns {Array<{ name: string, version: string }>}
 */
function parsePnpmLock(content, includeTests = false) {
  const lines = content.split('\n');
  const majorVersion = getPnpmMajorVersion(content);

  /** @type {Map<string, { name: string, version: string, dev: boolean }>} */
  const pkgMap   = new Map(); // `name@version` → entry (dedup same version at multiple paths)
  /** @type {Set<string>} direct dev dep names from importers: section (v9 only) */
  const devNames = new Set();

  let section         = 'other';  // current top-level YAML section
  let currentEntry    = null;     // package entry being built (v5/v6 dev-flag accumulation)
  let importerDepType = null;     // 'devDependencies' | null  (v9 importer sub-section)

  /** Commits currentEntry into pkgMap; deduplicates by name@version only. */
  function flushEntry() {
    if (!currentEntry) return;
    const dedupeKey = `${currentEntry.name}@${currentEntry.version}`;
    if (!pkgMap.has(dedupeKey)) pkgMap.set(dedupeKey, currentEntry);
    currentEntry = null;
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed === '---') continue; // skip blank lines and YAML doc markers

    const indent = rawLine.length - rawLine.trimStart().length;

    // ── Top-level section change (indent === 0) ──────────────────────────────
    if (indent === 0) {
      flushEntry();
      importerDepType = null;
      if      (trimmed === 'packages:')  section = 'packages';
      else if (trimmed === 'importers:') section = 'importers';
      else if (trimmed === 'snapshots:') section = 'snapshots'; // v9 — skip
      else                               section = 'other';
      continue;
    }

    // ── packages: section ────────────────────────────────────────────────────
    if (section === 'packages') {
      if (indent === 2 && trimmed.endsWith(':')) {
        // A new package entry key — flush the previous one first.
        flushEntry();
        const key    = trimmed.slice(0, -1).replace(/^['"]|['"]$/g, '');
        const parsed = parsePackageKey(key, majorVersion);
        currentEntry = parsed ? { ...parsed, dev: false } : null;
      } else if (indent === 4 && currentEntry) {
        if      (trimmed === 'dev: true')  currentEntry.dev = true;
        else if (trimmed === 'dev: false') currentEntry.dev = false;
      }
      continue;
    }

    // ── importers: section (v9 dev-detection) ────────────────────────────────
    if (section === 'importers') {
      if (indent === 2 && trimmed.endsWith(':')) {
        // Entering a new importer block — reset the dep-type tracker.
        importerDepType = null;
      } else if (indent === 4 && trimmed.endsWith(':')) {
        const key = trimmed.slice(0, -1);
        importerDepType = key === 'devDependencies' ? 'devDependencies' : null;
      } else if (indent === 6 && importerDepType === 'devDependencies' && trimmed.endsWith(':')) {
        devNames.add(trimmed.slice(0, -1).replace(/^['"]|['"]$/g, ''));
      }
    }
  }

  // Flush the final entry — the loop only flushes when the *next* entry begins,
  // so without this call the last package in the file would be silently dropped.
  flushEntry();

  // ── Build result list ─────────────────────────────────────────────────────
  const results = [];
  for (const entry of pkgMap.values()) {
    const isDev = majorVersion >= 9 ? devNames.has(entry.name) : entry.dev;
    if (!includeTests && isDev) continue;
    results.push({ name: entry.name, version: entry.version });
  }
  return results;
}

export { parsePnpmLock, getPnpmMajorVersion };
