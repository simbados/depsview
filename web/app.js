/**
 * Browser entry point for depsview.
 * Wires the HTML form to the dependency-resolution pipeline and renders
 * results into a table. All HTTP calls go directly to the GitHub Contents API
 * and PyPI JSON API from the browser — no server-side component is needed.
 *
 * Pure utility functions are exported so they can be tested with the Node.js
 * test runner without a DOM. DOM-manipulation code runs only when
 * `document` is available (browser context).
 */

import { parseGithubUrl } from '../src/githubUrl.js';
import { parseGithubDependencies } from '../src/githubParser.js';
import { resolveDependencies } from '../src/depResolver.js';

// ── Pure utility functions (exported for testing) ─────────────────────────────

/**
 * Formats an integer with locale-aware thousand separators (e.g. 1234 → "1,234").
 * Returns "–" when the value is null or undefined.
 * @param {number|null|undefined} n
 * @returns {string}
 */
export function formatNumber(n) {
  if (n == null) return '–';
  return n.toLocaleString();
}

/**
 * Returns the number of whole days elapsed between today and an ISO date string.
 * Returns Infinity for the sentinel value "unknown" or any date that cannot
 * be parsed, so unknown-dated entries consistently sort to the bottom.
 * @param {string|null|undefined} dateStr - ISO date string, e.g. "2024-03-15"
 * @returns {number} whole days elapsed, or Infinity
 */
export function daysSince(dateStr) {
  if (!dateStr || dateStr === 'unknown') return Infinity;
  const ms = Date.now() - new Date(dateStr).getTime();
  if (isNaN(ms)) return Infinity;
  return Math.floor(ms / 86_400_000);
}

/**
 * Sorts a Map of resolved dependency results by release date, newest first.
 * Packages whose release date is "unknown" sink to the bottom of the list
 * and are sorted alphabetically among themselves. Equal dates are also broken
 * alphabetically. Does not mutate the input Map.
 * @param {Map<string, object>} resultsMap - output of resolveDependencies()
 * @returns {Array<object>} sorted array of result objects
 */
export function sortResults(resultsMap) {
  return [...resultsMap.values()].sort((a, b) => {
    const dA = a.releaseDate ?? 'unknown';
    const dB = b.releaseDate ?? 'unknown';
    if (dA === 'unknown' && dB === 'unknown') return a.name.localeCompare(b.name);
    if (dA === 'unknown') return 1;
    if (dB === 'unknown') return -1;
    if (dA !== dB) return dB.localeCompare(dA); // ISO strings sort correctly as text
    return a.name.localeCompare(b.name);
  });
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

/**
 * Appends a new `<td>` cell to a table row, sets its text content, and returns it.
 * Using textContent (not innerHTML) ensures that no API-sourced data is ever
 * interpreted as HTML, preventing XSS.
 * @param {HTMLTableRowElement} row
 * @param {string} text
 * @returns {HTMLTableCellElement}
 */
function addCell(row, text) {
  const td = row.insertCell();
  td.textContent = text;
  return td;
}

/**
 * Populates the results container with a summary line and a dependency table.
 * Applies age-based CSS classes to the Released and First Release cells so they
 * are colour-coded like the CLI output (amber = fresh version, red = new package).
 * When downloadStats is true an additional Downloads/mo column is rendered.
 * @param {HTMLElement} container    - the #results div to populate
 * @param {Array<object>} sorted     - result objects from sortResults()
 * @param {number} directCount       - number of direct (non-transitive) dependencies
 * @param {boolean} downloadStats    - when true, render the Downloads/mo column
 */
function renderResults(container, sorted, directCount, downloadStats) {
  container.hidden = false;
  container.innerHTML = '';

  const total = sorted.length;
  const transitiveCount = total - directCount;

  const summary = document.createElement('p');
  summary.className = 'summary';
  summary.textContent =
    `${total} package${total !== 1 ? 's' : ''} total` +
    ` (${directCount} direct, ${transitiveCount} transitive)`;
  container.appendChild(summary);

  if (total === 0) {
    const msg = document.createElement('p');
    msg.textContent = 'No dependencies found.';
    container.appendChild(msg);
    return;
  }

  const table = document.createElement('table');

  // Header row
  const thead = table.createTHead();
  const headerRow = thead.insertRow();
  const columns = ['Package', 'Version', 'Released', 'First Release', 'Releases'];
  if (downloadStats) columns.push('Downloads/mo');
  for (const label of columns) {
    const th = document.createElement('th');
    th.textContent = label;
    headerRow.appendChild(th);
  }

  // Data rows
  const tbody = table.createTBody();
  for (const pkg of sorted) {
    const tr = tbody.insertRow();

    addCell(tr, pkg.name);

    if (pkg.error) {
      tr.className = 'row-error';
      // Collapse remaining columns into one to keep the row tidy
      const td = addCell(tr, pkg.version ?? 'error');
      td.colSpan = downloadStats ? 5 : 4;
      td.title = pkg.error;
      continue;
    }

    addCell(tr, pkg.version);

    const relCell = addCell(tr, pkg.releaseDate ?? 'unknown');
    if (daysSince(pkg.releaseDate) <= 7) relCell.className = 'age-fresh';

    const firstCell = addCell(tr, pkg.firstReleaseDate ?? 'unknown');
    if (daysSince(pkg.firstReleaseDate) <= 30) firstCell.className = 'age-new';

    addCell(tr, formatNumber(pkg.releaseCount ?? 0));
    if (downloadStats) addCell(tr, formatNumber(pkg.downloadsLastMonth));
  }

  container.appendChild(table);
}

// ── Browser initialisation ────────────────────────────────────────────────────

// Guard lets the module be imported in Node.js (for testing pure functions)
// without crashing on missing DOM APIs.
if (typeof document !== 'undefined') {
  const form              = document.getElementById('form');
  const urlInput          = document.getElementById('url-input');
  const includeTestsCb    = document.getElementById('include-tests');
  const downloadStatsCb   = document.getElementById('download-stats');
  const submitBtn         = document.getElementById('submit-btn');
  const errorDiv          = document.getElementById('error');
  const progressDiv       = document.getElementById('progress');
  const resultsDiv        = document.getElementById('results');

  /** Appends a line to the progress log and scrolls to the bottom. */
  function appendProgress(text) {
    progressDiv.hidden = false;
    progressDiv.textContent += text;
    progressDiv.scrollTop = progressDiv.scrollHeight;
  }

  /** Displays an error message in the error banner. */
  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.hidden = false;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Reset state from any previous run
    errorDiv.hidden = true;
    errorDiv.textContent = '';
    progressDiv.hidden = true;
    progressDiv.textContent = '';
    resultsDiv.hidden = true;
    resultsDiv.innerHTML = '';

    const url           = urlInput.value.trim();
    const includeTests  = includeTestsCb.checked;
    const downloadStats = downloadStatsCb.checked;

    let githubRef;
    try {
      githubRef = parseGithubUrl(url);
    } catch (err) {
      showError(err.message);
      return;
    }

    submitBtn.disabled = true;
    appendProgress('Fetching dependency files from GitHub…\n');

    try {
      const { deps, source } = await parseGithubDependencies(githubRef, { includeTests });
      const directNames = new Set(deps.map(d => d.name.toLowerCase()));

      appendProgress(
        `Found ${deps.length} direct ${deps.length === 1 ? 'dependency' : 'dependencies'} in: ${source}\n` +
        `Resolving…\n`
      );

      const results = await resolveDependencies(deps, {
        onProgress: (msg) => appendProgress(msg + '\n'),
        downloadStats,
      });

      progressDiv.hidden = true;

      const sorted = sortResults(results);
      const directCount = sorted.filter(r => directNames.has(r.name.toLowerCase())).length;
      renderResults(resultsDiv, sorted, directCount, downloadStats);
    } catch (err) {
      showError(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
}
