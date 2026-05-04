/**
 * package-lock.json parser.
 * Supports lockfileVersion 1, 2, and 3.
 * Returns a flat, deduplicated list of all installed packages with exact versions.
 * Packages flagged dev:true are excluded unless includeTests is true.
 */

/**
 * Extracts a package name from a node_modules path key used in v2/v3 lock files.
 * Keys look like "node_modules/lodash" or "node_modules/@scope/pkg".
 * For nested entries like "node_modules/a/node_modules/b" we take the final
 * package segment so every installed copy is represented.
 * Returns null for the root entry (empty string key).
 * @param {string} key
 * @returns {string|null}
 */
function nameFromKey(key) {
  if (!key) return null;
  const idx = key.lastIndexOf('node_modules/');
  if (idx === -1) return null;
  return key.slice(idx + 'node_modules/'.length);
}

/**
 * Parses a v2/v3 package-lock.json using the `packages` object.
 * The shallowest (first) entry for each name wins when duplicates exist.
 * @param {object} data - parsed JSON
 * @param {boolean} includeTests
 * @returns {Array<{ name: string, version: string }>}
 */
function parseV2(data, includeTests) {
  const packages = data.packages ?? {};
  const seen = new Map();

  for (const [key, pkg] of Object.entries(packages)) {
    if (!key) continue;
    if (!includeTests && pkg.dev === true) continue;
    const name = nameFromKey(key);
    if (!name || !pkg.version) continue;
    if (!seen.has(name)) seen.set(name, pkg.version);
  }

  return [...seen.entries()].map(([name, version]) => ({ name, version }));
}

/**
 * Recursively collects all packages from a v1 `dependencies` object.
 * Each entry may have its own nested `dependencies` for version conflicts.
 * First occurrence (outermost scope) wins on name collision.
 * @param {object} deps
 * @param {boolean} includeTests
 * @param {Map<string, string>} seen - accumulator keyed by package name
 */
function collectV1(deps, includeTests, seen) {
  for (const [name, pkg] of Object.entries(deps)) {
    if (!includeTests && pkg.dev === true) continue;
    if (pkg.version && !seen.has(name)) seen.set(name, pkg.version);
    if (pkg.dependencies) collectV1(pkg.dependencies, includeTests, seen);
  }
}

/**
 * Parses a v1 package-lock.json using the `dependencies` object.
 * @param {object} data - parsed JSON
 * @param {boolean} includeTests
 * @returns {Array<{ name: string, version: string }>}
 */
function parseV1(data, includeTests) {
  const seen = new Map();
  collectV1(data.dependencies ?? {}, includeTests, seen);
  return [...seen.entries()].map(([name, version]) => ({ name, version }));
}

/**
 * Parses a package-lock.json file into a flat, deduplicated list of installed packages.
 * Supports lockfileVersion 1, 2, and 3.
 * Packages with dev:true are excluded unless includeTests is true.
 * @param {string} content - raw file content
 * @param {boolean} includeTests - when true, dev packages are included
 * @returns {Array<{ name: string, version: string }>}
 */
function parsePackageLock(content, includeTests = false) {
  const data = JSON.parse(content);
  return (data.lockfileVersion ?? 1) >= 2
    ? parseV2(data, includeTests)
    : parseV1(data, includeTests);
}

export { parsePackageLock };
