#!/usr/bin/env node
/**
 * depsview — CLI entry point.
 * Supports Python projects (pyproject.toml, requirements.txt, …) and npm
 * projects (package-lock.json preferred, package.json fallback).
 * Auto-detects the ecosystem from the files present in the project directory
 * or GitHub URL; use --npm / --python to override.
 *
 * Usage:
 *   node src/main.js <path-or-github-url> [--npm|--python] [--json] [--debug]
 *                    [--include-tests] [--download-stats|--ds]
 */

import fs   from 'node:fs';
import path from 'node:path';

import { parseDependencyFile    as parsePythonFile   } from './python/parser.js';
import { resolveDependencies    as resolvePython      } from './python/depResolver.js';
import { normalizePackageName   as normalizePython    } from './python/pypiClient.js';

import { parseDependencyFile    as parseNpmFile       } from './npm/parser.js';
import { resolveDependencies    as resolveNpm         } from './npm/depResolver.js';
import { normalizePackageName   as normalizeNpm       } from './npm/depResolver.js';
import { parsePackageJson                             } from './npm/parserCore.js';

import { formatTable, formatJson } from './output/formatter.js';
import { setDebug                } from './util/debugging.js';
import { isGithubUrl, parseGithubUrl } from './github/url.js';
import { parseGithubDependencies, parseGithubNpmDependencies } from './github/parser.js';
import { listDirectory } from './github/client.js';

/** npm-specific filenames checked during local ecosystem detection. */
const NPM_FILES    = new Set(['package-lock.json', 'package.json']);
/** Python-specific filenames checked during local ecosystem detection. */
const PYTHON_FILES = new Set(['pyproject.toml', 'requirements.txt', 'setup.cfg', 'Pipfile', 'manifest.json']);

/**
 * Parses CLI arguments from process.argv.
 * @returns {{ projectPath: string, json: boolean, debug: boolean, includeTests: boolean, downloadStats: boolean, ecosystem: 'npm'|'python'|null }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const jsonFlag          = args.includes('--json');
  const debugFlag         = args.includes('--debug');
  const includeTestsFlag  = args.includes('--include-tests');
  const downloadStatsFlag = args.includes('--download-stats') || args.includes('--ds');
  const npmFlag           = args.includes('--npm');
  const pythonFlag        = args.includes('--python');
  const positional        = args.filter(a => !a.startsWith('--'));

  if (positional.length === 0) {
    console.error('Usage: depsview <path-to-project|github-url> [--npm|--python] [--json] [--debug] [--include-tests] [--download-stats|--ds]');
    console.error('');
    console.error('Python files: pyproject.toml, manifest.json, requirements.txt, setup.cfg, Pipfile');
    console.error('npm files:    package-lock.json (preferred), package.json');
    process.exit(1);
  }

  const ecosystem = npmFlag ? 'npm' : pythonFlag ? 'python' : null;
  return { projectPath: positional[0], json: jsonFlag, debug: debugFlag, includeTests: includeTestsFlag, downloadStats: downloadStatsFlag, ecosystem };
}

/**
 * Detects the package ecosystem from local filesystem.
 * Checks for npm files first; falls back to Python.
 * @param {string} dirPath - absolute path to the project root
 * @returns {'npm'|'python'}
 */
function detectLocalEcosystem(dirPath) {
  for (const f of NPM_FILES) {
    if (fs.existsSync(path.join(dirPath, f))) return 'npm';
  }
  return 'python';
}

/**
 * Detects the package ecosystem from a GitHub directory listing.
 * Checks for npm files first; falls back to Python.
 * @param {Array<{ name: string, type: string }>} listing
 * @returns {'npm'|'python'|null} null when no recognised files are found
 */
function detectGithubEcosystem(listing) {
  const names = new Set(listing.map(e => e.name));
  for (const f of NPM_FILES)    { if (names.has(f)) return 'npm'; }
  for (const f of PYTHON_FILES) { if (names.has(f)) return 'python'; }
  return null;
}

/**
 * Attempts to read a package.json at the project root to extract direct dep names.
 * Used alongside lock-file resolution to populate the direct/transitive footer.
 * Returns an empty Set if package.json is absent or unparseable.
 * @param {string} dirPath
 * @param {boolean} includeTests
 * @returns {Set<string>}
 */
function readDirectNamesFromPackageJson(dirPath, includeTests) {
  try {
    const content = fs.readFileSync(path.join(dirPath, 'package.json'), 'utf8');
    const direct  = parsePackageJson(content, includeTests);
    return new Set(direct.map(d => normalizeNpm(d.name)));
  } catch {
    return new Set();
  }
}

/**
 * Main entry point.
 * @returns {Promise<void>}
 */
async function main() {
  const { projectPath, json, debug, includeTests, downloadStats, ecosystem: ecosystemFlag } = parseArgs();
  if (debug) setDebug(true);

  const absolutePath = path.resolve(projectPath);

  // ── Step 1: Parse dependency file(s) ──────────────────────────────────────
  let deps, source, ecosystem, directNames;

  try {
    if (isGithubUrl(projectPath)) {
      const githubRef = parseGithubUrl(projectPath);

      // Detect ecosystem from the root listing unless overridden
      let eco = ecosystemFlag;
      if (!eco) {
        const listing = await listDirectory(githubRef.owner, githubRef.repo, githubRef.subpath, githubRef.ref);
        eco = detectGithubEcosystem(listing ?? []);
        if (!eco) {
          console.error('Error: Could not detect ecosystem (npm or Python). Use --npm or --python to specify.');
          process.exit(1);
        }
      }
      ecosystem = eco;

      if (ecosystem === 'npm') {
        ({ deps, source } = await parseGithubNpmDependencies(githubRef, { includeTests }));
      } else {
        ({ deps, source } = await parseGithubDependencies(githubRef, { includeTests }));
      }
    } else {
      ecosystem = ecosystemFlag ?? detectLocalEcosystem(absolutePath);

      if (ecosystem === 'npm') {
        ({ deps, source } = parseNpmFile(absolutePath, { includeTests }));
      } else {
        ({ deps, source } = parsePythonFile(absolutePath, { includeTests }));
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  if (deps.length === 0) {
    console.error(`No dependencies found in ${source}. The file may be empty or use an unsupported format.`);
    process.exit(0);
  }

  // ── Build directNames set ──────────────────────────────────────────────────
  // For lock-file sources, read package.json to know which deps are direct.
  // For package.json / Python sources, every input dep is direct.
  if (ecosystem === 'npm') {
    if (source === 'package-lock.json') {
      directNames = isGithubUrl(projectPath)
        ? new Set()
        : readDirectNamesFromPackageJson(absolutePath, includeTests);
    } else {
      directNames = new Set(deps.map(d => normalizeNpm(d.name)));
    }
  } else {
    directNames = new Set(deps.map(d => normalizePython(d.name)));
  }

  if (!json) {
    console.log(`Resolving ${ecosystem} dependencies from ${source} (${deps.length} ${source === 'package-lock.json' ? 'installed' : 'direct'})...\n`);
  }

  // ── Step 2: Resolve all deps ───────────────────────────────────────────────
  let results;
  try {
    if (ecosystem === 'npm') {
      results = await resolveNpm(deps, {
        onProgress: json ? undefined : msg => process.stderr.write(msg + '\n'),
      });
    } else {
      results = await resolvePython(deps, {
        onProgress: json ? undefined : msg => process.stderr.write(msg + '\n'),
        downloadStats,
      });
    }
  } catch (err) {
    console.error(`Fatal error during resolution: ${err.message}`);
    process.exit(1);
  }

  if (!json) process.stderr.write('\n');

  // ── Step 3: Format output ──────────────────────────────────────────────────
  if (json) {
    formatJson(results, { downloadStats: ecosystem === 'python' && downloadStats });
  } else {
    formatTable(results, directNames, { downloadStats: ecosystem === 'python' && downloadStats });
  }
}

main();
