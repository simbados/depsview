/**
 * Helpers for identifying test-related directories and requirement files.
 * Used to exclude test dependencies from the default dependency scan unless
 * the user passes --include-tests.
 */

/**
 * Directory names that are treated as test-only and skipped during traversal
 * when test dependencies are excluded (the default behaviour).
 * Comparison is done against lowercased names, so "Tests" and "TEST" also match.
 * @type {Set<string>}
 */
const TEST_DIR_NAMES = new Set(['test', 'tests', 'testing', 'e2e', 'integration_tests']);

/**
 * Keywords whose presence as a word segment in a requirements filename marks
 * the file as test-related. Segments are delimited by hyphens, underscores, or
 * dots (after the extension is stripped).
 * Examples that match: "requirements-test.txt", "dev-requirements.txt", "ci.txt"
 * Examples that do not match: "requirements.txt", "base-requirements.txt"
 * @type {Set<string>}
 */
const TEST_FILE_KEYWORDS = new Set(['test', 'tests', 'testing', 'dev', 'lint', 'docs', 'ci']);

/**
 * Returns true when the given directory name is a recognised test directory.
 * Comparison is case-insensitive so "Tests" and "TEST" are caught as well.
 * @param {string} name - the directory entry name (not a full path)
 * @returns {boolean}
 */
function isTestDirectory(name) {
  return TEST_DIR_NAMES.has(name.toLowerCase());
}

/**
 * Returns true when the given filename is a test-related requirements file.
 * Strips the file extension, splits the remainder on hyphens, underscores, and
 * dots, and checks whether any resulting segment exactly matches a keyword in
 * TEST_FILE_KEYWORDS.
 * @param {string} filename - basename of the file (not a full path)
 * @returns {boolean}
 */
function isTestRequirementsFile(filename) {
  const withoutExt = filename.toLowerCase().replace(/\.[^.]+$/, '');
  const segments = withoutExt.split(/[-_.]/);
  return segments.some(seg => TEST_FILE_KEYWORDS.has(seg));
}

export { isTestDirectory, isTestRequirementsFile };
