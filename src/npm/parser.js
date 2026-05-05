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
import { parsePnpmLock, getPnpmMajorVersion } from './pnpmLockParser.js';

/**
 * Reads and parses npm dependency files from a project directory.
 * Priority: package-lock.json → pnpm-lock.yaml → package.json.
 * Returns the parsed deps, a source label, and an optional note string.
 * note is set when pnpm-lock.yaml v9 is used, because that format cannot
 * distinguish dev-only packages from production packages.
 * @param {string} projectPath - absolute path to the npm project root
 * @param {{ includeTests?: boolean }} [options]
 * @returns {{ deps: Array<{ name: string, version?: string, versionSpec?: string|null }>, source: string, note: string|null }}
 */
function parseDependencyFile(projectPath, options = {}) {
  const { includeTests = false } = options;

  const lockPath = path.join(projectPath, 'package-lock.json');
  if (fs.existsSync(lockPath) && !fs.statSync(lockPath).isDirectory()) {
    try {
      return { deps: parsePackageLock(fs.readFileSync(lockPath, 'utf8'), includeTests), source: 'package-lock.json', note: null };
    } catch (err) {
      throw new Error(`Failed to parse package-lock.json: ${err.message}`);
    }
  }

  const pnpmLockPath = path.join(projectPath, 'pnpm-lock.yaml');
  if (fs.existsSync(pnpmLockPath) && !fs.statSync(pnpmLockPath).isDirectory()) {
    try {
      const content = fs.readFileSync(pnpmLockPath, 'utf8');
      const note = getPnpmMajorVersion(content) >= 9
        ? 'pnpm-lock.yaml v9 does not flag packages as dev-only — all installed packages are listed, including test and dev dependencies.'
        : null;
      return { deps: parsePnpmLock(content, includeTests), source: 'pnpm-lock.yaml', note };
    } catch (err) {
      throw new Error(`Failed to parse pnpm-lock.yaml: ${err.message}`);
    }
  }

  const pkgPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgPath) && !fs.statSync(pkgPath).isDirectory()) {
    try {
      return { deps: parsePackageJson(fs.readFileSync(pkgPath, 'utf8'), includeTests), source: 'package.json', note: null };
    } catch (err) {
      throw new Error(`Failed to parse package.json: ${err.message}`);
    }
  }

  throw new Error(`No npm dependency file found in ${projectPath}. Looked for: package-lock.json, pnpm-lock.yaml, package.json`);
}

export { parseDependencyFile };
