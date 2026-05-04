/**
 * Pure package.json dependency parser — no Node.js imports.
 * Browser-compatible. Filesystem operations live in npm/parser.js.
 */

/**
 * Returns true when a version spec string refers to a non-registry source
 * that cannot be resolved from the npm registry: local paths (file:, link:),
 * workspace references, git URLs, and bare relative paths.
 * @param {string|unknown} spec
 * @returns {boolean}
 */
function isNonRegistrySpec(spec) {
  if (typeof spec !== 'string') return true;
  return /^(file:|link:|workspace:|git\+|git:|github:|https?:|[./])/.test(spec.trim());
}

/**
 * Parses a package.json content string into a flat list of { name, versionSpec } pairs.
 * Always reads `dependencies`; reads `devDependencies` only when includeTests is true.
 * Silently skips entries whose spec is a local path, workspace reference, or git URL
 * since those cannot be resolved from the npm registry.
 * @param {string} content - raw package.json content
 * @param {boolean} includeTests - when true, devDependencies are included
 * @returns {Array<{ name: string, versionSpec: string|null }>}
 */
function parsePackageJson(content, includeTests = false) {
  const data = JSON.parse(content);
  const result = [];

  const collect = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [name, spec] of Object.entries(obj)) {
      if (isNonRegistrySpec(spec)) continue;
      result.push({ name, versionSpec: String(spec).trim() || null });
    }
  };

  collect(data.dependencies);
  if (includeTests) collect(data.devDependencies);

  return result;
}

export { parsePackageJson, isNonRegistrySpec };
