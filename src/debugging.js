/**
 * Lightweight debug logging module.
 * When debug mode is enabled via setDebug(true), debugLog writes a prefixed
 * message to stderr. All output goes to stderr so it never pollutes stdout
 * (table output or JSON) regardless of piping.
 * Debug mode is off by default; the CLI enables it with the --debug flag.
 */

/** @type {boolean} Whether debug output is currently enabled */
let enabled = false;

/**
 * Enables or disables debug output for the current process.
 * Must be called before any HTTP requests are made; typically invoked once
 * at startup by the CLI entry point when --debug is present.
 * @param {boolean} flag - true to enable debug output, false to disable
 * @returns {void}
 */
function setDebug(flag) {
  enabled = !!flag;
}

/**
 * Writes a debug message to stderr when debug mode is active.
 * Each message is prefixed with "[debug] " so it is easy to distinguish from
 * normal progress output. No-ops silently when debug mode is disabled.
 * Uses process.stderr in Node.js; falls back to console.error in a browser.
 * @param {string} message - the message to print
 * @returns {void}
 */
function debugLog(message) {
  if (!enabled) return;
  const line = `[debug] ${message}\n`;
  if (typeof process !== 'undefined' && process.stderr) {
    process.stderr.write(line);
  } else {
    console.error(line);
  }
}

export { setDebug, debugLog };
