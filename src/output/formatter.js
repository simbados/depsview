/**
 * Output formatters for the resolved dependency list.
 * Supports a human-readable padded column table (default) and JSON (--json flag).
 * The table applies ANSI color coding to individual cells when stdout is a TTY:
 *   "First Release" cell — red   when the package first appeared within the last 30 days
 *   "Released" cell      — yellow when the latest version was released within the last 7 days
 * Both can be colored simultaneously on the same row.
 */

const ANSI_RED    = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_GREEN  = '\x1b[32m';
const ANSI_RESET  = '\x1b[0m';

/**
 * Returns the number of whole days between a date string and a reference date.
 * Returns Infinity when the date string is missing or "unknown" so that those
 * cells never accidentally match a recency threshold.
 * @param {string} dateStr - ISO date string like "2023-05-22", or "unknown"
 * @param {Date} now - reference point for the age calculation
 * @returns {number} whole days elapsed, or Infinity if the date is unavailable
 */
function daysSince(dateStr, now) {
  if (!dateStr || dateStr === 'unknown') return Infinity;
  const diffMs = now - new Date(dateStr);
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Wraps a string in an ANSI color code + reset sequence, but only when color is
 * non-null and stdout is a TTY. When stdout is piped (e.g. redirected to a file
 * or another process) the raw string is returned so ANSI codes do not pollute the output.
 * The caller must pad the string to the desired column width BEFORE calling this function
 * because padEnd counts escape sequences as printable characters.
 * @param {string} cell - already-padded cell text
 * @param {string|null} color - ANSI escape code, or null for no color
 * @returns {string}
 */
function applyColor(cell, color) {
  if (!color || !process.stdout.isTTY) return cell;
  return `${color}${cell}${ANSI_RESET}`;
}

/**
 * Returns display text and ANSI color code for a supply chain score.
 * Scores are color-coded by severity: green ≥ 80 %, yellow 50–79 %, red < 50 %.
 * Null (score not available) returns a dash with no color.
 * @param {number|null} score - supply chain score in range 0–1, or null when unavailable
 * @returns {{ text: string, color: string|null }}
 */
function socketScoreDisplay(score) {
  if (score == null) return { text: '-', color: null };
  const pct  = Math.round(score * 100);
  const color = score >= 0.8 ? ANSI_GREEN : score >= 0.5 ? ANSI_YELLOW : ANSI_RED;
  return { text: `${pct}%`, color };
}

/**
 * Converts the resolved dependency map into a sorted array of result objects.
 * Primary sort: release date descending (newest first). ISO-8601 date strings
 * ("YYYY-MM-DD") compare correctly as plain strings, so localeCompare suffices.
 * Packages whose release date is "unknown" always sort to the bottom because
 * the letter 'u' would otherwise rank above any digit in a descending compare.
 * Secondary sort (tiebreaker): package name ascending for deterministic output.
 * Supply chain scores from socket.dev are joined by "name@version" key.
 * @param {Map<string, { name: string, version: string, releaseDate: string, firstReleaseDate: string, releaseCount: number, downloadsLastMonth: number|null, error?: string }>} results
 * @param {Map<string, number>} [socketScores] - optional Map of "name@version" → score (0–1)
 * @returns {Array<{ name: string, version: string, released: string, firstReleased: string, releases: number, downloadsLastMonth: number|null, supplyChain: number|null, error?: string }>}
 */
function sortedResults(results, socketScores = new Map()) {
  return [...results.values()]
    .map(r => ({
      name:               r.name,
      version:            r.version,
      released:           r.releaseDate,
      firstReleased:      r.firstReleaseDate ?? 'unknown',
      releases:           r.releaseCount ?? 0,
      downloadsLastMonth: r.downloadsLastMonth ?? null,
      link:               r.link ?? `https://pypi.org/project/${r.name}/`,
      error:              r.error,
      supplyChain:        socketScores.get(`${r.name.toLowerCase()}@${r.version}`) ?? null,
    }))
    .sort((a, b) => {
      const aUnknown = a.released === 'unknown';
      const bUnknown = b.released === 'unknown';
      if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
      const dateCmp = b.released.localeCompare(a.released);
      if (dateCmp !== 0) return dateCmp;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
}

/**
 * Formats a monthly download count for display in the table.
 * Returns the number formatted with thousand separators (e.g. 34,567,890),
 * or "-" when the value is null (stats unavailable for that package).
 * Uses en-US locale explicitly so the separator is always a comma regardless
 * of the system locale where the tool is run.
 * @param {number|null} count
 * @returns {string}
 */
function formatDownloads(count) {
  return count !== null ? count.toLocaleString('en-US') : '-';
}

/**
 * Formats the resolved dependency map as a padded plain-text table.
 * Default columns: Package, Version, Released, First Release, Releases, Downloads/mo, Link.
 * The Downloads/mo column is omitted when opts.downloadStats is false.
 * The Supply Chain column is shown when opts.socketScores is provided (even if empty).
 * When stdout is a TTY, individual cells are colored by recency or score severity:
 *   "Released" cell      — yellow when the latest version is ≤ 7 days old
 *   "First Release" cell — red    when the package first appeared ≤ 30 days ago
 *   "Supply Chain" cell  — green ≥ 80 %, yellow 50–79 %, red < 50 %
 * Packages with errors are flagged inline after the last column.
 * @param {Map<string, { name: string, version: string, releaseDate: string, firstReleaseDate: string, releaseCount: number, downloadsLastMonth: number|null, error?: string }>} results
 * @param {Set<string>} directNames - normalized names of direct (non-transitive) dependencies,
 *   used to report counts at the footer
 * @param {{ downloadStats?: boolean, socketScores?: Map<string,number>|null }} [opts]
 * @param {boolean} [opts.downloadStats=true] - when false, the Downloads/mo column is omitted
 * @param {Map<string,number>|null} [opts.socketScores=null] - when provided, adds a Supply Chain column
 */
function formatTable(results, directNames, opts = {}) {
  const { downloadStats = true, socketScores = null } = opts;
  const rows = sortedResults(results, socketScores ?? new Map());
  if (rows.length === 0) {
    console.log('No dependencies found.');
    return;
  }

  const showSocket = socketScores != null;

  // Compute column widths based on the widest value in each column
  const colName   = Math.max(7,  ...rows.map(r => r.name.length))     + 2;
  const colVer    = Math.max(7,  ...rows.map(r => r.version.length))   + 2;
  const colRel    = Math.max(8,  ...rows.map(r => r.released.length))  + 2;
  const colFirst  = Math.max(13, ...rows.map(r => r.firstReleased.length)) + 2;
  const colPop    = Math.max(8,  ...rows.map(r => String(r.releases).length)) + 2;
  const colDl     = downloadStats
    ? Math.max(12, ...rows.map(r => formatDownloads(r.downloadsLastMonth).length)) + 2
    : 0;
  const colSocket = showSocket
    ? Math.max(12, ...rows.map(r => socketScoreDisplay(r.supplyChain).text.length)) + 2
    : 0;
  const colLink   = Math.max(4,  ...rows.map(r => r.link.length)) + 2;

  const pad = (s, n) => String(s).padEnd(n);
  const divider = '-'.repeat(colName + colVer + colRel + colFirst + colPop + colDl + colSocket + colLink);

  console.log(
    pad('Package', colName) + pad('Version', colVer) + pad('Released', colRel) +
    pad('First Release', colFirst) + pad('Releases', colPop) +
    (downloadStats ? pad('Downloads/mo', colDl) : '') +
    (showSocket    ? pad('Supply Chain', colSocket) : '') +
    pad('Link', colLink)
  );
  console.log(divider);

  const now = new Date();
  for (const row of rows) {
    // Pad each cell to its column width first, then apply color.
    // Padding must happen before colorizing because ANSI escape sequences
    // are counted as characters by padEnd and would break alignment.
    const releasedCell = applyColor(pad(row.released,      colRel),   daysSince(row.released,      now) <= 7  ? ANSI_YELLOW : null);
    const firstRelCell = applyColor(pad(row.firstReleased, colFirst),  daysSince(row.firstReleased, now) <= 30 ? ANSI_RED    : null);

    let socketCell = '';
    if (showSocket) {
      const { text, color } = socketScoreDisplay(row.supplyChain);
      socketCell = applyColor(pad(text, colSocket), color);
    }

    let line = pad(row.name, colName)
      + pad(row.version, colVer)
      + releasedCell
      + firstRelCell
      + pad(row.releases, colPop)
      + (downloadStats ? pad(formatDownloads(row.downloadsLastMonth), colDl) : '')
      + socketCell
      + pad(row.link, colLink);
    if (row.error) line += `  [${row.error}]`;
    console.log(line);
  }

  console.log(divider);
  if (directNames.size > 0) {
    const directCount     = rows.filter(r => directNames.has(r.name.toLowerCase().replace(/[-_.]+/g, '-'))).length;
    const transitiveCount = rows.length - directCount;
    console.log(`${rows.length} packages total  (${directCount} direct, ${transitiveCount} transitive)`);
  } else {
    console.log(`${rows.length} packages total`);
  }
}

/**
 * Formats the resolved dependency map as a JSON array and prints it to stdout.
 * Each element has `name`, `version`, `released`, `firstReleased`, and `releases` fields.
 * `downloadsLastMonth` is included only when opts.downloadStats is true; omitting it
 * when downloads were not fetched avoids misleading null values in the output.
 * `supplyChainScore` is included only when opts.socketScores is provided; its value is
 * a float 0–1 or null when the package was not returned by the socket.dev API.
 * No ANSI codes are ever included in JSON output.
 * Packages with resolution errors include an additional `error` field.
 * @param {Map<string, { name: string, version: string, releaseDate: string, firstReleaseDate: string, releaseCount: number, downloadsLastMonth: number|null, error?: string }>} results
 * @param {{ downloadStats?: boolean, socketScores?: Map<string,number>|null }} [opts]
 * @param {boolean} [opts.downloadStats=true] - when false, downloadsLastMonth is omitted
 * @param {Map<string,number>|null} [opts.socketScores=null] - when provided, adds supplyChainScore to each entry
 */
function formatJson(results, opts = {}) {
  const { downloadStats = true, socketScores = null } = opts;
  const rows = sortedResults(results, socketScores ?? new Map()).map(r => {
    const obj = { name: r.name, version: r.version, released: r.released, firstReleased: r.firstReleased, releases: r.releases, link: r.link };
    if (downloadStats)     obj.downloadsLastMonth = r.downloadsLastMonth;
    if (socketScores != null) obj.supplyChainScore = r.supplyChain;
    if (r.error)           obj.error = r.error;
    return obj;
  });
  console.log(JSON.stringify(rows, null, 2));
}

export { formatTable, formatJson, sortedResults, daysSince, ANSI_RED, ANSI_YELLOW, ANSI_GREEN, ANSI_RESET };
