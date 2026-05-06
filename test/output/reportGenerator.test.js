/**
 * Tests for src/output/reportGenerator.js.
 * generateReport is a pure function (returns an HTML string) so all tests
 * simply call it and assert on the returned string — no DOM or fs required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateReport } from '../../src/output/reportGenerator.js';

/**
 * Builds a results Map in the same shape that depResolver produces.
 * @param {Array<object>} items
 * @returns {Map<string, object>}
 */
function makeResults(items) {
  const map = new Map();
  for (const item of items) {
    map.set(item.name.toLowerCase(), {
      name:             item.name,
      version:          item.version,
      releaseDate:      item.releaseDate      ?? 'unknown',
      firstReleaseDate: item.firstReleaseDate ?? 'unknown',
      releaseCount:     item.releaseCount     ?? 0,
      downloadsLastMonth: item.downloadsLastMonth ?? null,
      link:             item.link ?? `https://pypi.org/project/${item.name}/`,
      error:            item.error,
    });
  }
  return map;
}

// ── HTML structure ─────────────────────────────────────────────────────────────

describe('generateReport — HTML structure', () => {
  it('returns a complete HTML document', () => {
    const html = generateReport(new Map(), new Set());
    assert.ok(html.startsWith('<!DOCTYPE html>'), 'must start with DOCTYPE');
    assert.ok(html.includes('</html>'), 'must end with closing html tag');
  });

  it('sets the page title to "Dependency Report"', () => {
    const html = generateReport(new Map(), new Set());
    assert.ok(html.includes('<title>Dependency Report</title>'));
  });

  it('embeds a <style> block (self-contained, no external CSS)', () => {
    const html = generateReport(new Map(), new Set());
    assert.ok(html.includes('<style>'), 'must embed inline styles');
    assert.ok(!html.includes('<link rel="stylesheet"'), 'must not reference external CSS');
  });

  it('renders the "Dependency Report" heading', () => {
    const html = generateReport(new Map(), new Set());
    assert.ok(html.includes('Dependency Report'));
  });
});

// ── Meta line ──────────────────────────────────────────────────────────────────

describe('generateReport — meta line', () => {
  it('includes the ecosystem label when provided', () => {
    const html = generateReport(new Map(), new Set(), { ecosystem: 'npm' });
    assert.ok(html.includes('npm'));
  });

  it('includes the source file name when provided', () => {
    const html = generateReport(new Map(), new Set(), { source: 'package-lock.json' });
    assert.ok(html.includes('package-lock.json'));
  });

  it('includes a UTC timestamp', () => {
    const html = generateReport(new Map(), new Set());
    assert.ok(html.includes('UTC'));
  });
});

// ── Summary line ───────────────────────────────────────────────────────────────

describe('generateReport — summary line', () => {
  it('shows "0 packages total" for an empty map', () => {
    const html = generateReport(new Map(), new Set());
    assert.ok(html.includes('0 packages total'));
  });

  it('shows correct total count', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
      { name: 'certifi',  version: '2024.1', releaseDate: '2024-01-01' },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(html.includes('2 packages total'));
  });

  it('shows direct and transitive breakdown when directNames is non-empty', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
      { name: 'urllib3',  version: '2.0.0',  releaseDate: '2023-03-10' },
    ]);
    const directNames = new Set(['requests']);
    const html = generateReport(results, directNames);
    assert.ok(html.includes('1 direct'));
    assert.ok(html.includes('1 transitive'));
  });

  it('omits the direct/transitive breakdown when directNames is empty', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(!html.includes('direct'), 'must not mention "direct" when directNames is empty');
  });
});

// ── Table columns ─────────────────────────────────────────────────────────────

describe('generateReport — table columns', () => {
  it('renders all default column headers', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set());
    for (const header of ['Package', 'Version', 'Released', 'First Release', 'Releases', 'Downloads/mo']) {
      assert.ok(html.includes(header), `Expected column header "${header}"`);
    }
    assert.ok(!html.includes('<th>Link</th>'), 'Link column must not appear (name already links)');
  });

  it('omits the Downloads/mo column when downloadStats is false', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set(), { downloadStats: false });
    assert.ok(!html.includes('Downloads/mo'), 'Downloads/mo column must be absent');
  });

  it('adds the Supply Chain column when socketScores is provided', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set(), { socketScores: new Map() });
    assert.ok(html.includes('Supply Chain'), 'Supply Chain column must appear');
  });

  it('omits the Supply Chain column when socketScores is not provided', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(!html.includes('Supply Chain'), 'Supply Chain column must not appear without socketScores');
  });
});

// ── Package data ──────────────────────────────────────────────────────────────

describe('generateReport — package data', () => {
  it('renders the package name in a link to its registry page', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(html.includes('requests'));
    assert.ok(html.includes('https://pypi.org/project/requests/'));
  });

  it('renders the package version', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(html.includes('2.31.0'));
  });

  it('renders the release date', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(html.includes('2023-05-22'));
  });

  it('renders the first release date', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22', firstReleaseDate: '2011-02-14' },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(html.includes('2011-02-14'));
  });

  it('renders the release count', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22', releaseCount: 144 },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(html.includes('144'));
  });

  it('renders "–" for missing downloads', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22', downloadsLastMonth: null },
    ]);
    const html = generateReport(results, new Set(), { downloadStats: true });
    assert.ok(html.includes('–'));
  });

  it('renders a formatted download count', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22', downloadsLastMonth: 34_567_890 },
    ]);
    const html = generateReport(results, new Set(), { downloadStats: true });
    assert.ok(html.includes('34,567,890'));
  });
});

// ── Age classes ───────────────────────────────────────────────────────────────

describe('generateReport — age CSS classes', () => {
  it('applies age-fresh class when released within the last 7 days', () => {
    const fresh = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const results = makeResults([
      { name: 'new-release', version: '1.0.0', releaseDate: fresh },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(html.includes('class="age-fresh"'), `Expected class="age-fresh" in HTML for date ${fresh}`);
  });

  it('applies age-new class when firstReleaseDate within the last 30 days', () => {
    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const results = makeResults([
      { name: 'brand-new', version: '0.1.0', releaseDate: '2020-01-01', firstReleaseDate: recent },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(html.includes('class="age-new"'), `Expected class="age-new" in HTML for first release ${recent}`);
  });

  it('does not apply age-fresh to an old release date', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2020-01-01' },
    ]);
    const html = generateReport(results, new Set());
    // Check only the <tbody> — the embedded sort script legitimately contains
    // the string 'class="age-fresh"' as a JS literal, so we must not scan it.
    const tbody = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>') + 8);
    assert.ok(!tbody.includes('class="age-fresh"'), 'class="age-fresh" must not appear in tbody for an old release');
  });
});

// ── Supply chain scores ───────────────────────────────────────────────────────

describe('generateReport — supply chain scores', () => {
  it('renders a score as a percentage', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const socketScores = new Map([['requests@2.31.0', 0.87]]);
    const html = generateReport(results, new Set(), { socketScores });
    assert.ok(html.includes('87%'));
  });

  it('applies score-good class for scores >= 80%', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set(), { socketScores: new Map([['requests@2.31.0', 0.82]]) });
    assert.ok(html.includes('class="score-good"'));
  });

  it('applies score-warn class for scores between 50% and 79%', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set(), { socketScores: new Map([['requests@2.31.0', 0.65]]) });
    assert.ok(html.includes('class="score-warn"'));
  });

  it('applies score-bad class for scores below 50%', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set(), { socketScores: new Map([['requests@2.31.0', 0.30]]) });
    assert.ok(html.includes('class="score-bad"'));
  });

  it('renders "–" when a package has no score', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set(), { socketScores: new Map() });
    assert.ok(html.includes('–'));
  });

  it('links the score to socket.dev for PyPI packages', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set(), {
      socketScores: new Map([['requests@2.31.0', 0.87]]),
      ecosystem: 'python',
    });
    assert.ok(html.includes('https://socket.dev/pypi/package/requests'), 'must link to socket.dev/pypi for Python packages');
  });

  it('links the score to socket.dev for npm packages', () => {
    const results = makeResults([
      { name: 'express', version: '4.19.2', releaseDate: '2024-03-25',
        link: 'https://www.npmjs.com/package/express' },
    ]);
    const html = generateReport(results, new Set(), {
      socketScores: new Map([['express@4.19.2', 0.75]]),
      ecosystem: 'npm',
    });
    assert.ok(html.includes('https://socket.dev/npm/package/express'), 'must link to socket.dev/npm for npm packages');
  });

  it('does not link the score when ecosystem is unknown', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set(), {
      socketScores: new Map([['requests@2.31.0', 0.87]]),
      // no ecosystem provided
    });
    // Check only <tbody>: the sort script contains 'socket.dev' as a literal in the
    // helper that builds URLs, so we must not scan the full document.
    const tbody = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>') + 8);
    assert.ok(!tbody.includes('socket.dev'), 'must not link when ecosystem is unknown');
  });

  it('does not link the score when the score is absent for a package', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set(), {
      socketScores: new Map(), // score column shown but this package has no score
      ecosystem: 'python',
    });
    // Check only <tbody> for the same reason as above.
    const tbody = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>') + 8);
    assert.ok(!tbody.includes('socket.dev'), 'must not render a link when score is null');
  });
});

// ── Error rows ────────────────────────────────────────────────────────────────

describe('generateReport — error rows', () => {
  it('applies row-error class to packages with errors', () => {
    const results = makeResults([
      { name: 'broken', version: 'error', releaseDate: 'unknown', error: 'Package not found' },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(html.includes('row-error'));
  });

  it('still links the package name even for error rows', () => {
    const results = makeResults([
      { name: 'broken', version: 'error', releaseDate: 'unknown', error: 'Package not found' },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(html.includes('broken'));
  });
});

// ── XSS safety ───────────────────────────────────────────────────────────────

describe('generateReport — XSS safety', () => {
  it('escapes < and > in package names', () => {
    const results = makeResults([
      { name: '<script>alert(1)</script>', version: '1.0.0', releaseDate: '2023-01-01' },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(!html.includes('<script>alert'), 'raw <script> tag must not appear in output');
    assert.ok(html.includes('&lt;script&gt;'), 'name must be HTML-escaped');
  });

  it('escapes & in package versions', () => {
    const results = makeResults([
      { name: 'pkg', version: '1.0&beta', releaseDate: '2023-01-01' },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(html.includes('1.0&amp;beta'));
  });

  it('replaces a javascript: link with "#" in href attributes', () => {
    const results = makeResults([
      { name: 'evil', version: '1.0.0', releaseDate: '2023-01-01',
        link: 'javascript:alert(document.cookie)' },
    ]);
    const html = generateReport(results, new Set());
    // The href must be sanitised; the link text may still show the URL string
    // as visible text (harmless), so we check the attribute context specifically.
    assert.ok(!html.includes('href="javascript:'), 'javascript: must not appear as an href value');
    assert.ok(html.includes('href="#"'), 'unsafe link must be replaced with "#"');
  });

  it('replaces a data: link with "#" in href attributes', () => {
    const results = makeResults([
      { name: 'evil', version: '1.0.0', releaseDate: '2023-01-01',
        link: 'data:text/html,<script>alert(1)</script>' },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(!html.includes('href="data:'), 'data: URI must not appear as an href value');
    assert.ok(html.includes('href="#"'));
  });

  it('allows https:// links through', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22',
        link: 'https://pypi.org/project/requests/' },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(html.includes('href="https://pypi.org/project/requests/"'));
  });

  it('includes a Content-Security-Policy meta tag', () => {
    const html = generateReport(new Map(), new Set());
    assert.ok(html.includes('Content-Security-Policy'), 'CSP meta tag must be present');
    assert.ok(html.includes("default-src 'none'"), 'CSP must block all sources by default');
  });

  it('escapes < > in ecosystem and source names in the meta line', () => {
    const html = generateReport(new Map(), new Set(), { ecosystem: '<npm>', source: 'a&b.json' });
    assert.ok(!html.includes('<npm>'), 'raw < must not appear in meta line');
    assert.ok(html.includes('&lt;npm&gt;'));
    assert.ok(html.includes('a&amp;b.json'));
  });

  it("escapes single quotes in package names (defense in depth for ' in attributes)", () => {
    const results = makeResults([
      { name: "it's-a-package", version: '1.0.0', releaseDate: '2023-01-01' },
    ]);
    const html = generateReport(results, new Set());
    // Raw ' must not appear in any attribute value — it must be &#x27; instead
    assert.ok(!html.includes(`href="https://pypi.org/project/it's-a-package/"`),
      "raw ' must not appear unescaped in href attribute");
    assert.ok(html.includes('&#x27;'), "single quote must be encoded as &#x27;");
  });

  it('percent-encodes special URL characters in socket.dev link for package name', () => {
    // A package name containing characters that could corrupt a URL or inject HTML
    // must be percent-encoded before being placed in the href.
    const weirdName = 'pkg?inject=1&other=2';
    const results = makeResults([
      { name: weirdName, version: '1.0.0', releaseDate: '2023-05-22',
        link: 'https://pypi.org/project/pkg/' },
    ]);
    const html = generateReport(results, new Set(), {
      socketScores: new Map([[`${weirdName}@1.0.0`, 0.9]]),
      ecosystem: 'python',
    });
    assert.ok(!html.includes('socket.dev/pypi/package/pkg?inject=1'),
      'raw ? must not appear unencoded in socket.dev href');
    assert.ok(html.includes('pkg%3Finject%3D1'), 'special chars must be percent-encoded');
  });

  it('preserves @ and / in scoped npm package name in socket.dev link', () => {
    const results = makeResults([
      { name: '@scope/pkg', version: '1.0.0', releaseDate: '2023-05-22',
        link: 'https://www.npmjs.com/package/@scope/pkg' },
    ]);
    const html = generateReport(results, new Set(), {
      socketScores: new Map([['@scope/pkg@1.0.0', 0.8]]),
      ecosystem: 'npm',
    });
    assert.ok(html.includes('socket.dev/npm/package/@scope/pkg'),
      'scoped package @ and / must not be percent-encoded in socket.dev URL');
  });
});

// ── Sort UI (data-col attributes, script, nonce, CSP) ────────────────────────

describe('generateReport — sort UI', () => {
  it('adds data-col attribute to every column header', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set());
    // All default columns must carry a data-col attribute for the sort script
    for (const col of ['name', 'version', 'released', 'firstReleased', 'releases']) {
      assert.ok(html.includes(`data-col="${col}"`), `Expected data-col="${col}" on a <th>`);
    }
  });

  it('marks the Released header with th-sort-desc by default', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(
      html.includes('data-col="released"') && html.includes('th-sort-desc'),
      'Released column header must start with th-sort-desc class'
    );
  });

  it('embeds a <script> block', () => {
    const html = generateReport(new Map(), new Set());
    assert.ok(html.includes('<script '), 'must contain an inline script block');
  });

  it('uses a nonce on the script tag', () => {
    const html = generateReport(new Map(), new Set());
    assert.ok(/<script nonce="[A-Za-z0-9+/=]+"/.test(html), 'script tag must have a nonce attribute');
  });

  it('matches the nonce in the CSP meta tag and the script tag', () => {
    const html = generateReport(new Map(), new Set());
    const cspMatch    = html.match(/script-src 'nonce-([^']+)'/);
    const scriptMatch = html.match(/<script nonce="([^"]+)"/);
    assert.ok(cspMatch, 'CSP must contain script-src nonce');
    assert.ok(scriptMatch, 'script tag must have nonce attribute');
    assert.equal(cspMatch[1], scriptMatch[1], 'CSP nonce and script nonce must match');
  });

  it('embeds the row data as JSON in the script block', () => {
    const results = makeResults([
      { name: 'requests', version: '2.31.0', releaseDate: '2023-05-22' },
    ]);
    const html = generateReport(results, new Set());
    assert.ok(html.includes('"rows"'), 'embedded JSON must contain a rows key');
    assert.ok(html.includes('"requests"'), 'embedded JSON must contain the package name');
  });
});

// ── Sort order ────────────────────────────────────────────────────────────────

describe('generateReport — sort order', () => {
  it('renders packages newest-first', () => {
    const results = makeResults([
      { name: 'old', version: '1.0.0', releaseDate: '2020-01-01' },
      { name: 'new', version: '2.0.0', releaseDate: '2024-06-01' },
    ]);
    const html = generateReport(results, new Set());
    const posOld = html.indexOf('>old<');
    const posNew = html.indexOf('>new<');
    assert.ok(posNew < posOld, 'newer package must appear before older one in the HTML');
  });
});
