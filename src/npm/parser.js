/**
 * Node.js-specific npm dependency file reader.
 * Checks for package-lock.json first (preferred — contains the full resolved
 * dependency graph at exact versions); falls back to package.json.
 * File-system imports must not be added to parserCore.js or lockParser.js.
 */

import fs   from 'node:fs';
import path from 'node:path';
import { parsePackageJson } from './parserCore.js';
import { parsePackageLock } from './lockParser.js';

/**
 * Reads and parses npm dependency files from a project directory.
 * Priority: package-lock.json → package.json.
 * Returns the parsed deps and a source label indicating which file was used.
 * @param {string} projectPath - absolute path to the npm project root
 * @param {{ includeTests?: boolean }} [options]
 * @returns {{ deps: Array<{ name: string, version?: string, versionSpec?: string|null }>, source: string }}
 */
function parseDependencyFile(projectPath, options = {}) {
  const { includeTests = false } = options;

  const lockPath = path.join(projectPath, 'package-lock.json');
  if (fs.existsSync(lockPath) && !fs.statSync(lockPath).isDirectory()) {
    try {
      return { deps: parsePackageLock(fs.readFileSync(lockPath, 'utf8'), includeTests), source: 'package-lock.json' };
    } catch (err) {
      throw new Error(`Failed to parse package-lock.json: ${err.message}`);
    }
  }

  const pkgPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgPath) && !fs.statSync(pkgPath).isDirectory()) {
    try {
      return { deps: parsePackageJson(fs.readFileSync(pkgPath, 'utf8'), includeTests), source: 'package.json' };
    } catch (err) {
      throw new Error(`Failed to parse package.json: ${err.message}`);
    }
  }

  throw new Error(`No npm dependency file found in ${projectPath}. Looked for: package-lock.json, package.json`);
}

export { parseDependencyFile };
