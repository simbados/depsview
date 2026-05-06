/**
 * Generates a self-contained HTML dependency report.
 * All CSS is inlined so the output file has no external dependencies and can be
 * opened directly in a browser or attached to a PR / email.
 * The visual design mirrors web/index.html (same dark theme, same color classes).
 */

import { randomBytes } from 'node:crypto';
import { sortedResults } from './formatter.js';

/**
 * Escapes a string for safe insertion into HTML text content or attribute values
 * (both double- and single-quoted). Encodes & < > " ' so the string cannot
 * break out of any syntactic context it is placed into.
 * Encoding order: & first so subsequent replacements don't double-encode.
 * @param {string|number|null|undefined} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Returns an HTML-escaped URL safe for use in an href attribute.
 * Only http:// and https:// URLs are allowed; anything else (javascript:,
 * data:, vbscript:, relative paths, …) is replaced with the safe sentinel "#".
 * escapeHtml alone is insufficient for href values because it does not
 * validate the URL scheme and would pass `javascript:…` through unchanged.
 * @param {string|null|undefined} url
 * @returns {string}
 */
function safeHref(url) {
  const s = String(url ?? '');
  return /^https?:\/\//i.test(s) ? escapeHtml(s) : '#';
}

/**
 * Returns the number of whole days between an ISO date string and today.
 * Returns Infinity for missing or "unknown" dates so they never match a recency
 * threshold.
 * @param {string|null|undefined} dateStr
 * @returns {number}
 */
function daysSince(dateStr) {
  if (!dateStr || dateStr === 'unknown') return Infinity;
  const ms = Date.now() - new Date(dateStr).getTime();
  if (isNaN(ms)) return Infinity;
  return Math.floor(ms / 86_400_000);
}

/**
 * Maps a supply chain score (0–1) to one of three CSS class names.
 * Returns null when score is unavailable so callers can render a neutral dash.
 * @param {number|null} score
 * @returns {{ text: string, className: string|null }}
 */
function scoreDisplay(score) {
  if (score == null) return { text: '–', className: null };
  const pct = Math.round(score * 100);
  const className = score >= 0.8 ? 'score-good' : score >= 0.5 ? 'score-warn' : 'score-bad';
  return { text: `${pct}%`, className };
}

/**
 * Returns the socket.dev package URL for a given package name and ecosystem slug.
 * Returns null when socketEcosystem is falsy (ecosystem unknown) so callers can
 * fall back to plain text instead of a broken link.
 *
 * The package name is percent-encoded via encodeURIComponent to prevent characters
 * such as `?`, `#`, `&`, `<`, `>`, and spaces from corrupting the URL structure.
 * `@` and `/` are restored after encoding because socket.dev expects scoped npm
 * package names in their literal form (e.g. `@scope/name`, not `%40scope%2Fname`).
 *
 * @param {string} name                 - package name as it appears in the registry
 * @param {string|null} socketEcosystem - "npm" or "pypi" (already mapped from CLI ecosystem)
 * @returns {string|null}
 */
function socketPackageUrl(name, socketEcosystem) {
  if (!socketEcosystem) return null;
  const encoded = encodeURIComponent(name).replace(/%40/g, '@').replace(/%2F/gi, '/');
  return `https://socket.dev/${socketEcosystem}/package/${encoded}`;
}

/**
 * Formats a monthly download count as a locale string with thousand separators,
 * or returns "–" when the value is null.
 * @param {number|null} count
 * @returns {string}
 */
function formatDownloads(count) {
  return count !== null ? count.toLocaleString('en-US') : '–';
}

/** Inline CSS block shared by every generated report. */
const REPORT_CSS = `
:root {
  --bg: #0f172a;
  --surface: #1e293b;
  --border: #334155;
  --text: #f1f5f9;
  --muted: #94a3b8;
  --accent: #818cf8;
  --red: #fca5a5;
  --green: #4ade80;
}
* { box-sizing: border-box; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  margin: 0;
  padding: 2rem 1.5rem;
  line-height: 1.6;
}
main { max-width: 1200px; margin: 0 auto; }
h1 {
  font-size: 1.75rem;
  font-weight: 700;
  margin: 0 0 0.25rem;
  background: linear-gradient(90deg, #e879f9 0%, #818cf8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.meta { color: var(--muted); font-size: 0.85rem; margin: 0.25rem 0 1.5rem; }
.summary { color: var(--muted); font-size: 0.88rem; margin: 0 0 0.75rem; }
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
thead tr { border-bottom: 2px solid var(--border); }
th {
  text-align: left;
  padding: 0.65rem 0.9rem;
  font-weight: 600;
  white-space: nowrap;
  color: var(--muted);
}
th[data-col] { cursor: pointer; user-select: none; }
th[data-col]:hover { color: var(--text); }
th.th-sort-desc::after { content: ' ▼'; font-size: 0.75em; opacity: 0.8; }
th.th-sort-asc::after  { content: ' ▲'; font-size: 0.75em; opacity: 0.8; }
td { padding: 0.55rem 0.9rem; border-bottom: 1px solid var(--border); }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover td { background: #273548; }
.age-fresh { color: #fcd34d; font-weight: 500; }
.age-new   { color: var(--red); font-weight: 500; }
.row-error td { color: var(--muted); font-style: italic; }
table a { color: var(--accent); text-decoration: none; }
table a:hover { text-decoration: underline; }
.score-good { color: var(--green); font-weight: 500; }
.score-warn { color: #fcd34d; font-weight: 500; }
.score-bad  { color: var(--red); font-weight: 500; }
`.trim();

/**
 * Builds a single `<td>` HTML string, optionally wrapped in a CSS class.
 * @param {string} content  - already-escaped cell text or inner HTML
 * @param {string|null} [className]
 * @returns {string}
 */
function td(content, className = null) {
  return className
    ? `<td class="${escapeHtml(className)}">${content}</td>`
    : `<td>${content}</td>`;
}

/**
 * Renders one table row for a resolved package.
 * @param {object}      row             - entry from sortedResults()
 * @param {boolean}     showDl          - whether the Downloads/mo column is visible
 * @param {boolean}     showSocket      - whether the Supply Chain column is visible
 * @param {string|null} socketEcosystem - "npm" or "pypi", used to link scores to socket.dev
 * @returns {string}
 */
function renderRow(row, showDl, showSocket, socketEcosystem) {
  if (row.error) {
    const nameCell = `<td><a href="${safeHref(row.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.name)}</a></td>`;
    const errCell  = `<td colspan="${3 + (showDl ? 1 : 0) + (showSocket ? 1 : 0)}" title="${escapeHtml(row.error)}">${escapeHtml(row.version ?? 'error')}</td>`;
    return `<tr class="row-error">${nameCell}${errCell}</tr>`;
  }

  const relClass   = daysSince(row.released)     <= 7  ? 'age-fresh' : null;
  const firstClass = daysSince(row.firstReleased) <= 30 ? 'age-new'   : null;
  const { text: scoreText, className: scoreClass } = scoreDisplay(row.supplyChain);

  // Show the score as coloured text followed by a "(link)" anchor to socket.dev.
  // The percentage keeps its CSS colour from the parent <td>; the link gets the
  // accent colour from the shared `table a` rule.
  const socketUrl = socketPackageUrl(row.name, socketEcosystem);
  const scoreContent = (row.supplyChain != null && socketUrl)
    ? `${escapeHtml(scoreText)} <a href="${safeHref(socketUrl)}" target="_blank" rel="noopener noreferrer">(link)</a>`
    : escapeHtml(scoreText);

  const nameCell = `<td><a href="${safeHref(row.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.name)}</a></td>`;

  return `<tr>
    ${nameCell}
    ${td(escapeHtml(row.version))}
    ${td(escapeHtml(row.released), relClass)}
    ${td(escapeHtml(row.firstReleased), firstClass)}
    ${td(escapeHtml(String(row.releases)))}
    ${showDl     ? td(escapeHtml(formatDownloads(row.downloadsLastMonth))) : ''}
    ${showSocket ? td(scoreContent, scoreClass) : ''}
  </tr>`;
}

/**
 * Returns the inline JavaScript that handles column sorting in the report.
 * The script is an IIFE that reads the embedded JSON data, re-sorts it on
 * every header click, and rebuilds the <tbody> innerHTML from scratch.
 * All user-supplied strings that go into innerHTML are HTML-escaped inside
 * the script so a malicious package name cannot inject markup.
 * @param {string} scriptDataJson - already-safe JSON string (< > encoded as < >)
 * @returns {string} JavaScript source (no surrounding <script> tags)
 */
function buildSortScript(scriptDataJson) {
  return `(function(){
var D=${scriptDataJson};
var sortCol='released',sortDir='desc';
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');}
function safeUrl(u){var s=String(u==null?'':u);return/^https?:\\/\\//i.test(s)?s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):'#';}
function daysSince(d){if(!d||d==='unknown')return Infinity;var ms=Date.now()-new Date(d).getTime();return isNaN(ms)?Infinity:Math.floor(ms/86400000);}
function scoreInfo(v){if(v==null||typeof v!=='number')return{text:'\\u2013',cls:''};var p=Math.round(v*100);return{text:p+'%',cls:v>=0.8?'score-good':v>=0.5?'score-warn':'score-bad'};}
function socketUrl(name){if(!D.socketEcosystem)return null;var n=encodeURIComponent(name).replace(/%40/g,'@').replace(/%2F/gi,'/');return'https://socket.dev/'+D.socketEcosystem+'/package/'+n;}
function buildRow(r){
  if(r.error){
    var ec=3+(D.showDl?1:0)+(D.showSocket?1:0);
    return '<tr class="row-error"><td><a href="'+safeUrl(r.link)+'" target="_blank" rel="noopener noreferrer">'+esc(r.name)+'</a></td><td colspan="'+ec+'" title="'+esc(r.error)+'">'+esc(r.version||'error')+'</td></tr>';
  }
  var rc=daysSince(r.released)<=7?' class="age-fresh"':'';
  var fc=daysSince(r.firstReleased)<=30?' class="age-new"':'';
  var dl=D.showDl?'<td>'+(typeof r.downloadsLastMonth==='number'?r.downloadsLastMonth.toLocaleString('en-US'):'\\u2013')+'</td>':'';
  var si=D.showSocket?(function(){
    var s=scoreInfo(r.supplyChain);
    var su=socketUrl(r.name);
    var inner=r.supplyChain!=null&&su?s.text+' <a href="'+safeUrl(su)+'" target="_blank" rel="noopener noreferrer">(link)</a>':s.text;
    return'<td'+(s.cls?' class="'+s.cls+'"':'')+'>'+inner+'</td>';
  })():'';
  return'<tr><td><a href="'+safeUrl(r.link)+'" target="_blank" rel="noopener noreferrer">'+esc(r.name)+'</a></td><td>'+esc(r.version)+'</td><td'+rc+'>'+esc(r.released)+'</td><td'+fc+'>'+esc(r.firstReleased)+'</td><td>'+esc(String(r.releases))+'</td>'+dl+si+'</tr>';
}
function sortedRows(){
  var sign=sortDir==='asc'?1:-1;
  var isDate=sortCol==='released'||sortCol==='firstReleased';
  var isNum=sortCol==='releases'||sortCol==='downloadsLastMonth'||sortCol==='supplyChain';
  return D.rows.slice().sort(function(a,b){
    var av=a[sortCol],bv=b[sortCol];
    if(isDate){
      var au=!av||av==='unknown',bu=!bv||bv==='unknown';
      if(au&&bu)return a.name.localeCompare(b.name);
      if(au)return 1;if(bu)return-1;
      var c=String(av).localeCompare(String(bv));
      return c!==0?sign*c:a.name.localeCompare(b.name);
    }
    if(isNum){
      var an=av==null,bn=bv==null;
      if(an&&bn)return a.name.localeCompare(b.name);
      if(an)return 1;if(bn)return-1;
      var c=av-bv;
      return c!==0?sign*c:a.name.localeCompare(b.name);
    }
    var c=String(av==null?'':av).localeCompare(String(bv==null?'':bv));
    return c!==0?sign*c:a.name.localeCompare(b.name);
  });
}
function rerender(){
  var rows=sortedRows();
  var ncols=document.querySelectorAll('thead th').length;
  document.querySelector('tbody').innerHTML=rows.length?rows.map(buildRow).join(''):'<tr><td colspan="'+ncols+'">No dependencies found.</td></tr>';
  document.querySelectorAll('th[data-col]').forEach(function(th){
    th.classList.remove('th-sort-asc','th-sort-desc');
    if(th.dataset.col===sortCol)th.classList.add('th-sort-'+sortDir);
  });
}
document.querySelectorAll('th[data-col]').forEach(function(th){
  th.addEventListener('click',function(){
    var col=th.dataset.col;
    if(sortCol===col){sortDir=sortDir==='asc'?'desc':'asc';}
    else{sortCol=col;sortDir=(col==='name'||col==='version')?'asc':'desc';}
    rerender();
  });
});
})();`;
}

/**
 * Generates a complete, self-contained HTML dependency report as a string.
 *
 * The report matches the terminal table in data and column layout. It applies
 * the same age-based color classes (age-fresh, age-new) and supply chain score
 * classes (score-good, score-warn, score-bad) as the web UI.
 *
 * @param {Map<string, object>} results        - resolved dependency map from depResolver
 * @param {Set<string>}         directNames    - normalised names of direct dependencies
 * @param {object}              [opts]
 * @param {boolean}             [opts.downloadStats=true]   - include the Downloads/mo column
 * @param {Map<string,number>|null} [opts.socketScores=null] - supply chain scores; column shown when non-null
 * @param {string|null}         [opts.source=null]    - source file name shown in the report header
 * @param {string|null}         [opts.ecosystem=null] - ecosystem label shown in the report header
 * @returns {string} complete HTML document
 */
function generateReport(results, directNames, opts = {}) {
  const { downloadStats = true, socketScores = null, source = null, ecosystem = null } = opts;

  // Map CLI ecosystem labels to socket.dev URL slugs.
  // "python" uses "pypi" on socket.dev; "npm" is the same in both.
  const socketEcosystem = ecosystem === 'python' ? 'pypi' : ecosystem === 'npm' ? 'npm' : null;

  const rows       = sortedResults(results, socketScores ?? new Map());
  const showSocket = socketScores != null;
  const showDl     = downloadStats;
  const total      = rows.length;

  // ── Summary line ────────────────────────────────────────────────────────────
  let summaryText;
  if (directNames.size > 0) {
    const directCount     = rows.filter(r => directNames.has(r.name.toLowerCase().replace(/[-_.]+/g, '-'))).length;
    const transitiveCount = total - directCount;
    summaryText = `${total} package${total !== 1 ? 's' : ''} total (${directCount} direct, ${transitiveCount} transitive)`;
  } else {
    summaryText = `${total} package${total !== 1 ? 's' : ''} total`;
  }

  // ── Meta line ───────────────────────────────────────────────────────────────
  // Build the plain-text string first, then escape once at the insertion point
  // (same pattern as summaryText). Pre-escaping individual parts and then
  // inserting the joined string raw would be fragile and inconsistent.
  const metaParts = [];
  if (ecosystem) metaParts.push(ecosystem);
  if (source)    metaParts.push(`from ${source}`);
  metaParts.push(`generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`);
  const metaText = metaParts.join(' · ');

  // ── Table headers with sort keys ────────────────────────────────────────────
  const colDefs = [
    ['Package',       'name'],
    ['Version',       'version'],
    ['Released',      'released'],
    ['First Release', 'firstReleased'],
    ['Releases',      'releases'],
  ];
  if (showDl)     colDefs.push(['Downloads/mo', 'downloadsLastMonth']);
  if (showSocket) colDefs.push(['Supply Chain', 'supplyChain']);

  // 'released' column starts with descending sort indicator (newest first default).
  const headerHtml = colDefs.map(([label, col]) =>
    `<th data-col="${escapeHtml(col)}"${col === 'released' ? ' class="th-sort-desc"' : ''}>${escapeHtml(label)}</th>`
  ).join('');

  // ── Table rows (initial render, default sort already applied) ───────────────
  const bodyHtml = total === 0
    ? `<tr><td colspan="${colDefs.length}">No dependencies found.</td></tr>`
    : rows.map(r => renderRow(r, showDl, showSocket, socketEcosystem)).join('\n');

  // ── Embed row data for client-side re-sort ───────────────────────────────────
  // Escape </script> sequences inside the JSON so they cannot prematurely close
  // the script block. < / > are valid JSON/JS unicode escapes.
  const scriptData = JSON.stringify({ rows, showDl, showSocket, socketEcosystem })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');

  // CSP nonce: a fresh random value per report so only this exact script block
  // is allowed to run — tighter than 'unsafe-inline'.
  const nonce = randomBytes(16).toString('base64');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
  <title>Dependency Report</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
  <main>
    <h1>Dependency Report</h1>
    <p class="meta">${escapeHtml(metaText)}</p>
    <p class="summary">${escapeHtml(summaryText)}</p>
    <table>
      <thead><tr>${headerHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  </main>
  <script nonce="${nonce}">${buildSortScript(scriptData)}</script>
</body>
</html>`;
}

export { generateReport };
