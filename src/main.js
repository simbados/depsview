#!/usr/bin/env node
/**
 * depsview — CLI entry point.
 * Usage: node src/main.js <path-to-python-project> [--json] [--debug]
 *
 * Resolves all direct and transitive Python dependencies of the given project
 * by parsing its dependency file and querying the PyPI JSON API.
 * Prints a table of Package / Version / Released to stdout.
 */

import path from 'node:path';
import { parseDependencyFile } from './python/parser.js';
import { resolveDependencies } from './python/depResolver.js';
import { normalizePackageName } from './python/pypiClient.js';
import { formatTable, formatJson } from './output/formatter.js';
import { setDebug } from './util/debugging.js';
import { isGithubUrl, parseGithubUrl } from './github/url.js';
import { parseGithubDependencies } from './github/parser.js';

/**
 * Parses CLI arguments from process.argv.
 * Expects: node main.js <project-path> [--json] [--debug] [--include-tests] [--download-stats|--ds]
 * @returns {{ projectPath: string, json: boolean, debug: boolean, includeTests: boolean, downloadStats: boolean }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const jsonFlag          = args.includes('--json');
  const debugFlag         = args.includes('--debug');
  const includeTestsFlag  = args.includes('--include-tests');
  const downloadStatsFlag = args.includes('--download-stats') || args.includes('--ds');
  const positional = args.filter(a => !a.startsWith('--'));

  if (positional.length === 0) {
    console.error('Usage: depsview <path-to-python-project|github-url> [--json] [--debug] [--include-tests] [--download-stats|--ds]');
    console.error('');
    console.error('Supported dependency files: pyproject.toml, manifest.json, requirements.txt, setup.cfg, Pipfile');
    process.exit(1);
  }

  return { projectPath: positional[0], json: jsonFlag, debug: debugFlag, includeTests: includeTestsFlag, downloadStats: downloadStatsFlag };
}

/**
 * Main entry point. Parses arguments, resolves dependencies, and prints the result.
 * Exits with code 1 on unrecoverable errors (no dependency file, unreadable path).
 * Exits with code 0 on success even if some packages had resolution warnings.
 * @returns {Promise<void>}
 */
async function main() {
  const { projectPath, json, debug, includeTests, downloadStats } = parseArgs();
  if (debug) setDebug(true);
  const absolutePath = path.resolve(projectPath);

  // ── Step 1: Parse dependency file(s) ──────────────────────────────────────
  let deps, source;
  try {
    if (isGithubUrl(projectPath)) {
      const githubRef = parseGithubUrl(projectPath);
      ({ deps, source } = await parseGithubDependencies(githubRef, { includeTests }));
    } else {
      ({ deps, source } = parseDependencyFile(absolutePath, { includeTests }));
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  if (deps.length === 0) {
    console.error(`No dependencies found in ${source}. The file may be empty or use an unsupported format.`);
    process.exit(0);
  }

  if (!json) {
    console.log(`Resolving dependencies from ${source} (${deps.length} direct)...\n`);
  }

  // ── Step 2: Resolve all transitive deps via PyPI ───────────────────────────
  const directNames = new Set(deps.map(d => normalizePackageName(d.name)));

  let results;
  try {
    results = await resolveDependencies(deps, {
      onProgress: json ? undefined : msg => process.stderr.write(msg + '\n'),
      downloadStats,
    });
  } catch (err) {
    console.error(`Fatal error during resolution: ${err.message}`);
    process.exit(1);
  }

  if (!json) process.stderr.write('\n');

  // ── Step 3: Format and print output ───────────────────────────────────────
  if (json) {
    formatJson(results, { downloadStats });
  } else {
    formatTable(results, directNames, { downloadStats });
  }
}

main();
