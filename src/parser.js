/**
 * Node.js-specific wrapper for Python project dependency parsing.
 * Pure string-parsing functions live in parserCore.js (browser-compatible).
 * This module adds file-system operations: reading local files, resolving -r
 * includes in requirements.txt, and discovering which dep file to parse.
 * File-system imports must not be added to parserCore.js.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isTestRequirementsFile } from './testFilter.js';
import {
  parseDependencyString,
  parseRequiresDist,
  parsePyprojectToml,
  parseSetupCfg,
  parsePipfile,
  parseManifestJson,
} from './parserCore.js';

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
