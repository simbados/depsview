/**
 * GitHub-aware dependency parser.
 * Given a parsed GitHub reference (owner, repo, ref, subpath), traverses the
 * directory tree up to MAX_DEPTH levels deep, collects every recognised
 * dependency file, fetches and parses each one, then merges the results into a
 * single deduplicated dependency list.
 *
 * When the same package is declared in more than one file its version constraints
 * are joined with a comma so the existing resolveVersion logic handles them as a
 * combined constraint (e.g. ">=2.28" + "<3.0" → ">=2.28,<3.0").
 */

import { listDirectory, fetchFileContent } from './client.js';
import {
  parseDependencyString,
  parsePyprojectToml,
  parseManifestJson,
  parseSetupCfg,
  parsePipfile,
} from '../python/parserCore.js';
import { normalizePackageName } from '../python/pypiClient.js';
import { isTestDirectory, isTestRequirementsFile } from '../python/testFilter.js';

/** Recognised dependency filenames, checked case-sensitively against the repo listing. */
const DEP_FILENAMES = new Set(['pyproject.toml', 'manifest.json', 'requirements.txt', 'setup.cfg', 'Pipfile']);

/**
 * How many directory levels below the starting path to search.
 * 0 = only the given directory, 1 = its immediate subdirectories, 2 = one level
 * further. Depth 2 covers the typical Home Assistant layout where manifest.json
 * lives at custom_components/<integration>/ relative to the repo root.
 */
const MAX_DEPTH = 2;

/**
 * Resolves a relative include path against a base directory path.
 * Handles ".." segments so that "-r ../other.txt" works correctly when the
 * including requirements.txt lives in a subdirectory.
 * @param {string} base     - directory path of the including file (empty = repo root)
 * @param {string} relative - relative path from the -r directive
 * @returns {string} resolved path from the repo root
 */
function resolvePath(base, relative) {
  const parts = base ? base.split('/') : [];
  for (const seg of relative.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Parses a requirements.txt file fetched from GitHub, resolving "-r" includes
 * by fetching the referenced files from the same repository.
 * Mirrors the synchronous parseRequirementsTxt in parser.js but uses async
 * GitHub fetches for included files instead of fs.readFileSync.
 *
 * Security: `visited` is a Set of repo-relative paths already parsed in this
 * include chain. Any path that has already been visited is silently skipped,
 * preventing infinite recursion from self-referencing or A→B→A circular includes.
 * Unlike the local filesystem variant there is no path-traversal risk because
 * all paths are sent to the GitHub Contents API which only serves files within
 * the repository; they cannot escape repo scope regardless of `..` segments.
 *
 * @param {string} content    - raw file content
 * @param {string} owner      - GitHub user or organisation name
 * @param {string} repo       - repository name
 * @param {string} baseDir    - directory of this file within the repo (empty = root)
 * @param {string} ref        - branch, tag, or commit SHA
 * @param {Set<string>} visited - repo-relative paths already parsed in this chain
 * @param {boolean} includeTests - when false (default), skip -r includes whose
 *   filename contains a test-related keyword (e.g. requirements-test.txt)
 * @returns {Promise<Array<{ name: string, versionSpec: string|null }>>}
 */
async function parseRequirementsTxtAsync(content, owner, repo, baseDir, ref, visited = new Set(), includeTests = false) {
  const deps = [];

  for (let line of content.split('\n')) {
    line = line.split('#')[0].trim();
    while (line.endsWith('\\')) line = line.slice(0, -1).trim();
    if (!line) continue;

    if (/^(-r|--requirement)\s+/.test(line)) {
      const includePath = line.replace(/^(-r|--requirement)\s+/, '').trim();

      // Skip test requirement includes unless the caller opted in
      if (!includeTests) {
        const basename = includePath.includes('/') ? includePath.slice(includePath.lastIndexOf('/') + 1) : includePath;
        if (isTestRequirementsFile(basename)) continue;
      }

      const fullPath    = resolvePath(baseDir, includePath);

      // Security: skip already-visited paths (circular include guard)
      if (visited.has(fullPath)) continue;

      const includeDir     = fullPath.includes('/') ? fullPath.slice(0, fullPath.lastIndexOf('/')) : '';
      const includeContent = await fetchFileContent(owner, repo, fullPath, ref);
      if (includeContent) {
        deps.push(...await parseRequirementsTxtAsync(includeContent, owner, repo, includeDir, ref, new Set([...visited, fullPath]), includeTests));
      }
      continue;
    }

    if (/^-/.test(line)) continue;

    const dep = parseDependencyString(line);
    if (dep) deps.push(dep);
  }

  return deps;
}

/**
 * Merges dependency lists from multiple files into a single deduplicated array.
 * Packages are keyed by their normalised name (lowercase, [-_.] collapsed to -).
 * When the same package appears more than once its version constraints are combined
 * with a comma so they are treated as a joint constraint by resolveVersion.
 * The first occurrence's original name casing is preserved.
 * @param {Array<{ name: string, versionSpec: string|null }>} allDeps
 * @returns {Array<{ name: string, versionSpec: string|null }>}
 */
function mergeDeps(allDeps) {
  /** @type {Map<string, { name: string, versionSpec: string|null }>} */
  const map = new Map();

  for (const dep of allDeps) {
    const key = normalizePackageName(dep.name);
    if (!map.has(key)) {
      map.set(key, { name: dep.name, versionSpec: dep.versionSpec });
    } else {
      const existing = map.get(key);
      if (dep.versionSpec && existing.versionSpec) {
        existing.versionSpec = `${existing.versionSpec},${dep.versionSpec}`;
      } else if (dep.versionSpec) {
        existing.versionSpec = dep.versionSpec;
      }
    }
  }

  return [...map.values()];
}

/**
 * Recursively lists the given directory and all subdirectories up to maxDepth
 * levels below it. Returns an array of { dirPath, depFiles } objects — one entry
 * for each directory that contains at least one recognised dependency filename.
 * Subdirectory listings at the same level are fetched in parallel.
 * @param {string} owner         - GitHub user or organisation name
 * @param {string} repo          - repository name
 * @param {string} ref           - branch, tag, or commit SHA
 * @param {string} dirPath       - current directory path (empty = repo root)
 * @param {number} depth         - current recursion depth (0 = starting directory)
 * @param {boolean} includeTests - when false (default), directories with test-related
 *   names (e.g. "tests", "e2e") are skipped entirely during traversal
 * @returns {Promise<Array<{ dirPath: string, depFiles: string[] }>>}
 */
async function findDepFiles(owner, repo, ref, dirPath, depth, includeTests = false) {
  const listing = await listDirectory(owner, repo, dirPath, ref);
  if (!listing) return [];

  const depFiles = listing
    .filter(entry => entry.type === 'file' && DEP_FILENAMES.has(entry.name))
    .map(entry => entry.name);

  const localResult = depFiles.length > 0 ? [{ dirPath, depFiles }] : [];

  if (depth >= MAX_DEPTH) return localResult;

  const subdirs = listing
    .filter(entry => entry.type === 'dir')
    .filter(entry => includeTests || !isTestDirectory(entry.name));

  const childResults = await Promise.all(
    subdirs.map(subdir => findDepFiles(owner, repo, ref, subdir.path, depth + 1, includeTests))
  );

  return [...localResult, ...childResults.flat()];
}

/**
 * Parses all Python dependency files found within MAX_DEPTH levels of the given
 * directory in a GitHub repository and returns a merged, deduplicated dep list.
 *
 * Steps:
 *   1. Traverse the directory tree up to MAX_DEPTH levels looking for dep files.
 *   2. Fetch all discovered files in parallel.
 *   3. Parse each file using the appropriate parser.
 *   4. Merge all results, combining version constraints for duplicate packages.
 *
 * @param {{ owner: string, repo: string, ref: string, subpath: string }} githubRef
 * @param {{ includeTests?: boolean }} [options] - parsing options
 * @param {boolean} [options.includeTests=false] - when true, test directories and
 *   test requirement files are included in the scan
 * @returns {Promise<{ deps: Array<{ name: string, versionSpec: string|null }>, source: string }>}
 * @throws {Error} when no dep files are found anywhere in the traversed tree
 */
async function parseGithubDependencies({ owner, repo, ref, subpath }, options = {}) {
  const { includeTests = false } = options;

  // Check that the starting directory actually exists before traversing, so we
  // can give a clear "Directory not found" error instead of "no dep files found".
  const rootListing = await listDirectory(owner, repo, subpath, ref);
  if (!rootListing) {
    const dir = subpath || '/';
    throw new Error(`Directory not found: ${dir} in ${owner}/${repo} at ref "${ref}"`);
  }

  const found = await findDepFiles(owner, repo, ref, subpath, 0, includeTests);

  if (found.length === 0) {
    const location = subpath ? `${owner}/${repo}/${subpath}` : `${owner}/${repo}`;
    throw new Error(
      `No dependency file found in ${location} (ref: ${ref}, searched ${MAX_DEPTH} levels deep). ` +
      `Looked for: ${[...DEP_FILENAMES].join(', ')}`
    );
  }

  // Fetch all dep files across all directories in parallel
  const fetchJobs = found.flatMap(({ dirPath, depFiles }) =>
    depFiles.map(async name => {
      const filePath = dirPath ? `${dirPath}/${name}` : name;
      const content = await fetchFileContent(owner, repo, filePath, ref);
      return { name, filePath, dirPath, content };
    })
  );
  const fetched = await Promise.all(fetchJobs);

  // Parse each file and collect all deps
  const allDepArrays = await Promise.all(
    fetched
      .filter(({ content }) => content !== null)
      .map(async ({ name, filePath, dirPath, content }) => {
        const baseDir = dirPath || '';
        if (name === 'pyproject.toml')     return { filePath, deps: parsePyprojectToml(content, includeTests) };
        if (name === 'manifest.json')      return { filePath, deps: parseManifestJson(content) };
        if (name === 'requirements.txt')   return { filePath, deps: await parseRequirementsTxtAsync(content, owner, repo, baseDir, ref, new Set([filePath]), includeTests) };
        if (name === 'setup.cfg')          return { filePath, deps: parseSetupCfg(content) };
        if (name === 'Pipfile')            return { filePath, deps: parsePipfile(content, includeTests) };
        return { filePath, deps: [] };
      })
  );

  return {
    deps: mergeDeps(allDepArrays.flatMap(({ deps }) => deps)),
    source: allDepArrays.map(({ filePath }) => filePath).join(', '),
  };
}

export { parseGithubDependencies, resolvePath, mergeDeps };
