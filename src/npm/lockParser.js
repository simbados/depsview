/**
 * package-lock.json parser.
 * Supports lockfileVersion 1, 2, and 3.
 * Returns a flat list of all installed packages with exact versions.
 * Packages with the same name but different versions are each included.
 * The same name@version appearing at multiple nested paths is listed once.
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
 * Deduplicates by name@version so the same package at multiple nested paths
 * is listed once per distinct version — different versions are each included.
 * @param {object} data - parsed JSON
 * @param {boolean} includeTests
 * @returns {Array<{ name: string, version: string }>}
 */
function parseV2(data, includeTests) {
  const packages = data.packages ?? {};
  const seen    = new Set(); // name@version keys already added
  const results = [];

  for (const [key, pkg] of Object.entries(packages)) {
    if (!key) continue;
    if (!includeTests && pkg.dev === true) continue;
    const name = nameFromKey(key);
    if (!name || !pkg.version) continue;
    const dedupeKey = `${name.toLowerCase()}@${pkg.version}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      results.push({ name, version: pkg.version });
    }
  }

  return results;
}

/**
 * Recursively collects all packages from a v1 `dependencies` object.
 * Each entry may have its own nested `dependencies` for version conflicts.
 * Deduplicates by name@version — different versions of the same name are each included.
 * @param {object} deps
 * @param {boolean} includeTests
 * @param {Set<string>} seen - name@version keys already added
 * @param {Array<{ name: string, version: string }>} results - accumulator
 */
function collectV1(deps, includeTests, seen, results) {
  for (const [name, pkg] of Object.entries(deps)) {
    if (!includeTests && pkg.dev === true) continue;
    if (pkg.version) {
      const dedupeKey = `${name.toLowerCase()}@${pkg.version}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        results.push({ name, version: pkg.version });
      }
    }
    if (pkg.dependencies) collectV1(pkg.dependencies, includeTests, seen, results);
  }
}

/**
 * Parses a v1 package-lock.json using the `dependencies` object.
 * @param {object} data - parsed JSON
 * @param {boolean} includeTests
 * @returns {Array<{ name: string, version: string }>}
 */
function parseV1(data, includeTests) {
  const seen    = new Set();
  const results = [];
  collectV1(data.dependencies ?? {}, includeTests, seen, results);
  return results;
}

/**
 * Parses a package-lock.json file into a flat list of installed packages.
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
