/**
 * Browser entry point for depsview.
 * Wires the HTML form to the dependency-resolution pipeline and renders
 * results into a table. All HTTP calls go directly to the GitHub Contents API
 * and the PyPI / npm registry APIs from the browser — no server-side component.
 *
 * Ecosystem auto-detection: after the GitHub root directory is listed, the
 * presence of package-lock.json or package.json selects npm; otherwise Python.
 *
 * Pure utility functions are exported for testing with the Node.js test runner
 * without a DOM. DOM-manipulation code runs only when `document` is available.
 */

import { parseGithubUrl               } from './src/github/url.js';
import { parseGithubDependencies,
         parseGithubNpmDependencies   } from './src/github/parser.js';
import { resolveDependencies          } from './src/python/depResolver.js';
import { resolveDependencies as resolveNpm } from './src/npm/depResolver.js';
import { setGithubToken               } from './src/github/client.js';
import { listDirectory                } from './src/github/client.js';

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
 * Returns Infinity for "unknown" or unparseable dates so those entries sort last.
 * @param {string|null|undefined} dateStr
 * @returns {number}
 */
export function daysSince(dateStr) {
  if (!dateStr || dateStr === 'unknown') return Infinity;
  const ms = Date.now() - new Date(dateStr).getTime();
  if (isNaN(ms)) return Infinity;
  return Math.floor(ms / 86_400_000);
}

/**
 * Sorts a Map of resolved dependency results by an arbitrary column.
 * "unknown" date strings and null numeric values always sink to the bottom
 * regardless of direction, so the table stays readable.
 * String columns (name, version) use localeCompare; date columns compare
 * ISO-8601 strings lexicographically (valid because YYYY-MM-DD is zero-padded);
 * numeric columns compare by value. All sorts use name as a tiebreaker.
 * @param {Map<string, object>} resultsMap
 * @param {'name'|'version'|'releaseDate'|'firstReleaseDate'|'releaseCount'|'downloadsLastMonth'|'supplyChain'} column
 * @param {'asc'|'desc'} direction
 * @returns {Array<object>}
 */
export function sortResultsBy(resultsMap, column, direction) {
  const sign   = direction === 'asc' ? 1 : -1;
  const isDate = column === 'releaseDate' || column === 'firstReleaseDate';
  const isNum  = column === 'releaseCount' || column === 'downloadsLastMonth' || column === 'supplyChain';

  return [...resultsMap.values()].sort((a, b) => {
    const aVal = a[column] ?? (isDate ? 'unknown' : null);
    const bVal = b[column] ?? (isDate ? 'unknown' : null);

    if (isDate) {
      const aUnk = aVal === 'unknown';
      const bUnk = bVal === 'unknown';
      if (aUnk && bUnk) return a.name.localeCompare(b.name);
      if (aUnk) return 1;
      if (bUnk) return -1;
      const cmp = aVal.localeCompare(bVal);
      return cmp !== 0 ? sign * cmp : a.name.localeCompare(b.name);
    }

    if (isNum) {
      const aNull = aVal == null;
      const bNull = bVal == null;
      if (aNull && bNull) return a.name.localeCompare(b.name);
      if (aNull) return 1;
      if (bNull) return -1;
      const cmp = aVal - bVal;
      return cmp !== 0 ? sign * cmp : a.name.localeCompare(b.name);
    }

    // String columns: name, version
    const cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''));
    return cmp !== 0 ? sign * cmp : 0;
  });
}

/**
 * Sorts a Map of resolved dependency results by release date, newest first.
 * "unknown" dates sink to the bottom, sorted alphabetically among themselves.
 * Does not mutate the input Map.
 * @param {Map<string, object>} resultsMap
 * @returns {Array<object>}
 */
export function sortResults(resultsMap) {
  return sortResultsBy(resultsMap, 'releaseDate', 'desc');
}

/**
 * Detects whether a GitHub directory listing contains npm or Python dep files.
 * npm detection (package-lock.json / package.json) takes precedence.
 * Returns null when neither is detected.
 * @param {Array<{ name: string, type: string }>} listing
 * @returns {'npm'|'python'|null}
 */
export function detectEcosystem(listing) {
  const names = new Set(listing.map(e => e.name));
  if (names.has('package-lock.json') || names.has('pnpm-lock.yaml') || names.has('package.json')) return 'npm';
  if (names.has('pyproject.toml') || names.has('requirements.txt') ||
      names.has('setup.cfg')      || names.has('Pipfile') ||
      names.has('manifest.json'))                                    return 'python';
  return null;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

/**
 * Appends a `<td>` cell with text content to a row and returns it.
 * Uses textContent to prevent XSS from API-sourced package names.
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
 * Applies age-based CSS classes to the Released and First Release cells.
 * Package names link to their registry page (PyPI or npmjs.com) via each
 * result's `link` property.
 * @param {HTMLElement} container
 * @param {Array<object>} sorted   - result objects from sortResults()
 * @param {number} directCount     - 0 when unknown (lock-file resolution without package.json)
 * @param {string|null} [note]     - optional informational note shown below the summary
 */
function renderResults(container, sorted, directCount, note = null) {
  container.hidden = false;
  container.innerHTML = '';

  const total = sorted.length;

  const summary = document.createElement('p');
  summary.className = 'summary';
  if (directCount > 0) {
    const transitiveCount = total - directCount;
    summary.textContent = `${total} package${total !== 1 ? 's' : ''} total (${directCount} direct, ${transitiveCount} transitive)`;
  } else {
    summary.textContent = `${total} package${total !== 1 ? 's' : ''} total`;
  }
  container.appendChild(summary);

  if (note) {
    const noteEl = document.createElement('p');
    noteEl.className = 'note note-warning';
    noteEl.textContent = `ⓘ ${note}`;
    container.appendChild(noteEl);
  }

  if (total === 0) {
    const msg = document.createElement('p');
    msg.textContent = 'No dependencies found.';
    container.appendChild(msg);
    return;
  }

  const table = document.createElement('table');

  const thead = table.createTHead();
  const headerRow = thead.insertRow();
  const COL_DEFS = [
    ['Package',       'name'],
    ['Version',       'version'],
    ['Released',      'releaseDate'],
    ['First Release', 'firstReleaseDate'],
    ['Releases',      'releaseCount'],
  ];
  for (const [label, col] of COL_DEFS) {
    const th = document.createElement('th');
    th.textContent = label;
    th.dataset.col = col;
    headerRow.appendChild(th);
  }

  const tbody = table.createTBody();
  for (const pkg of sorted) {
    const tr = tbody.insertRow();

    const nameTd = tr.insertCell();
    const a = document.createElement('a');
    a.href   = pkg.link ?? `https://pypi.org/project/${pkg.name}/`;
    a.target = '_blank';
    a.rel    = 'noopener noreferrer';
    a.textContent = pkg.name;
    nameTd.appendChild(a);

    if (pkg.error) {
      tr.className = 'row-error';
      const td = addCell(tr, pkg.version ?? 'error');
      td.colSpan = 4;
      td.title = pkg.error;
      continue;
    }

    addCell(tr, pkg.version);

    const relCell = addCell(tr, pkg.releaseDate ?? 'unknown');
    if (daysSince(pkg.releaseDate) <= 7) relCell.className = 'age-fresh';

    const firstCell = addCell(tr, pkg.firstReleaseDate ?? 'unknown');
    if (daysSince(pkg.firstReleaseDate) <= 30) firstCell.className = 'age-new';

    addCell(tr, formatNumber(pkg.releaseCount ?? 0));
  }

  container.appendChild(table);
}

// ── Browser initialisation ────────────────────────────────────────────────────

if (typeof document !== 'undefined') {
  const form            = document.getElementById('form');
  const urlInput        = document.getElementById('url-input');
  const tokenInput      = document.getElementById('token-input');
  const rememberTokenCb = document.getElementById('remember-token');
  const storageNote     = document.getElementById('storage-note');
  const includeTestsCb  = document.getElementById('include-tests');
  const submitBtn       = document.getElementById('submit-btn');
  const errorDiv        = document.getElementById('error');
  const progressDiv     = document.getElementById('progress');
  const resultsDiv      = document.getElementById('results');

  const TOKEN_STORAGE_KEY = 'depsview.github_token';

  function syncStorageNote() {
    storageNote.hidden = !rememberTokenCb.checked;
  }

  const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (savedToken) {
    tokenInput.value      = savedToken;
    rememberTokenCb.checked = true;
    syncStorageNote();
  }

  rememberTokenCb.addEventListener('change', () => {
    syncStorageNote();
    if (rememberTokenCb.checked) {
      const token = tokenInput.value.trim();
      if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  });

  function appendProgress(text) {
    progressDiv.hidden = false;
    progressDiv.textContent += text;
    progressDiv.scrollTop = progressDiv.scrollHeight;
  }

  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.hidden = false;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    errorDiv.hidden    = true;
    errorDiv.textContent = '';
    progressDiv.hidden = true;
    progressDiv.textContent = '';
    resultsDiv.hidden  = true;
    resultsDiv.innerHTML = '';

    const url          = urlInput.value.trim();
    const token        = tokenInput.value.trim();
    const includeTests = includeTestsCb.checked;

    if (rememberTokenCb.checked && token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }

    setGithubToken(token || null);

    let githubRef;
    try {
      githubRef = parseGithubUrl(url);
    } catch (err) {
      showError(err.message);
      return;
    }

    submitBtn.disabled = true;
    appendProgress('Detecting ecosystem…\n');

    try {
      // List the root directory to detect ecosystem
      const listing = await listDirectory(githubRef.owner, githubRef.repo, githubRef.subpath, githubRef.ref);
      // Fall back to 'python' when no files are recognised at the root —
      // parseGithubDependencies will traverse up to MAX_DEPTH levels and throw
      // a clear error if nothing is found there either (covers HA integrations
      // where manifest.json sits at custom_components/<name>/).
      const ecosystem = detectEcosystem(listing ?? []) ?? 'python';

      appendProgress(`Detected: ${ecosystem}. Fetching dependency files from GitHub…\n`);

      let deps, source, directCount, note = null;

      if (ecosystem === 'npm') {
        ({ deps, source, note } = await parseGithubNpmDependencies(githubRef, { includeTests }));
      } else {
        ({ deps, source } = await parseGithubDependencies(githubRef, { includeTests }));
      }

      // Lock files don't carry direct/transitive info — omit the breakdown (directCount = 0)
      const isLockFile = source === 'package-lock.json' || source === 'pnpm-lock.yaml';
      directCount = isLockFile ? 0 : deps.length;

      appendProgress(
        `Found ${deps.length} ${isLockFile ? 'installed' : 'direct'} ` +
        `${deps.length === 1 ? 'dependency' : 'dependencies'} in: ${source}\n` +
        `Resolving…\n`
      );

      let results;
      if (ecosystem === 'npm') {
        results = await resolveNpm(deps, {
          onProgress: (msg) => appendProgress(msg + '\n'),
        });
        // After resolution, recalculate directCount against resolved names (package.json only)
        if (!isLockFile) {
          const directNames = new Set(deps.map(d => d.name.toLowerCase()));
          directCount = [...results.values()].filter(r => directNames.has(r.name.toLowerCase())).length;
        }
      } else {
        const directNames = new Set(deps.map(d => d.name.toLowerCase()));
        results = await resolveDependencies(deps, {
          onProgress: (msg) => appendProgress(msg + '\n'),
        });
        directCount = [...results.values()].filter(r => directNames.has(r.name.toLowerCase())).length;
      }

      progressDiv.hidden = true;

      // Sort state lives in this submission's closure so each new search
      // starts fresh without affecting a concurrent tab or previous state.
      let sortCol = 'releaseDate';
      let sortDir = 'desc';

      function rerender() {
        renderResults(resultsDiv, sortResultsBy(results, sortCol, sortDir), directCount, note);

        // Wire sort handlers onto the freshly rendered headers.
        resultsDiv.querySelectorAll('th[data-col]').forEach(th => {
          const col = th.dataset.col;
          th.classList.toggle('th-sort-asc',  col === sortCol && sortDir === 'asc');
          th.classList.toggle('th-sort-desc', col === sortCol && sortDir === 'desc');
          th.addEventListener('click', () => {
            if (sortCol === col) {
              sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            } else {
              sortCol = col;
              // Dates and counts default to descending; strings default to ascending.
              sortDir = (col === 'name' || col === 'version') ? 'asc' : 'desc';
            }
            rerender();
          });
        });
      }

      rerender();
    } catch (err) {
      showError(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
}
