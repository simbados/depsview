# depsview

Lists all dependencies and transitive dependencies of a Python or npm project. For each package it shows the resolved version, release dates, and total number of published versions. All data is fetched live — no local Python or Node.js installation required.

Built with [Claude Code](https://claude.ai/code).

**Data sources:** [PyPI](https://pypi.org/) for Python packages, [registry.npmjs.org](https://registry.npmjs.org) for npm packages, [api.github.com](https://docs.github.com/en/rest) for GitHub URL support, [pypistats.org](https://pypistats.org/) for Python download statistics (optional), [socket.dev](https://socket.dev/) for supply chain security scores (optional).

## Requirements

Node.js 18 or later. No third-party dependencies.

## Usage

```bash
node src/main.js <path-to-project|github-url> [options]
```

The ecosystem (Python or npm) is **auto-detected** from the files present. Use `--npm` or `--python` to override when both are present.

```bash
# Auto-detect
node src/main.js ./my-python-project
node src/main.js ./my-node-project
node src/main.js https://github.com/owner/repo

# Explicit ecosystem
node src/main.js ./mixed-repo --npm
node src/main.js ./mixed-repo --python
```

**Example output (npm):**

```
Resolving npm dependencies from package-lock.json (142 installed)...

Package     Version   Released     First Release  Releases  Link
------------------------------------------------------------------
vite        5.1.0     2024-02-08   2020-04-25     89        https://www.npmjs.com/package/vite
lodash      4.17.21   2021-02-20   2012-01-13     116       https://www.npmjs.com/package/lodash
eslint      8.57.0    2024-02-24   2013-06-23     312       https://www.npmjs.com/package/eslint
------------------------------------------------------------------
142 packages total
```

**Example output (Python):**

```
Resolving python dependencies from requirements.txt (2 direct)...

Package   Version   Released     First Release  Releases  Link
---------------------------------------------------------------
requests  2.31.0    2023-05-22   2011-02-14     144       https://pypi.org/project/requests/
certifi   2024.2.2  2024-02-02   2011-09-30     29        https://pypi.org/project/certifi/
---------------------------------------------------------------
2 packages total  (2 direct, 0 transitive)
```

Results are sorted by release date (newest first).

## Flags

| Flag | Description |
|---|---|
| `--npm` | Force npm ecosystem |
| `--python` | Force Python ecosystem |
| `--include-tests` | Include dev/test dependencies |
| `--json` | Machine-readable JSON output |
| `--download-stats` / `--ds` | Fetch Python download counts from pypistats.org (Python only) |
| `--socket-key=<key>` | Socket.dev API key — enables the Supply Chain column |
| `--socket-org=<slug>` | Socket.dev organisation slug (required with `--socket-key`) |
| `--debug` | Print API errors and warnings to stderr |

Both socket flags can also be supplied as environment variables `SOCKET_KEY` and `SOCKET_ORG`; the `--socket-key` / `--socket-org` flags take precedence when both are present.

## npm support

Lock files are always preferred over `package.json`. The priority order is:

1. `package-lock.json` (npm)
2. `pnpm-lock.yaml` (pnpm)
3. `package.json` (fallback — recursive registry resolution)

### package-lock.json

When a `package-lock.json` is present, depsview reads the complete list of installed packages directly from it — no recursive registry traversal needed. Packages flagged `"dev": true` are excluded unless `--include-tests` is passed.

Supports lockfileVersion 1, 2, and 3.

### pnpm-lock.yaml

When a `pnpm-lock.yaml` is present, depsview reads the flat package list from the `packages:` section.

Supports lockfile versions 5, 6, and 9:

| Version | pnpm | Dev-package detection |
|---|---|---|
| 5 | ≤6 | `dev: true` flag inside each entry |
| 6 | 7/8 | `dev: true` flag inside each entry |
| 9 | 9+ | `devDependencies` in the `importers:` section |

### package.json fallback

When no lock file is found, depsview reads `package.json` and recursively resolves all transitive dependencies from the npm registry, following each package's `dependencies` field.

### Scoped packages

Scoped package names (e.g. `@babel/core`, `@types/node`) are fully supported throughout.

### devDependencies

Pass `--include-tests` to include `devDependencies` alongside `dependencies`.

## Python support

### Supported dependency file formats

| File | Format | Notes |
|---|---|---|
| `pyproject.toml` | PEP 621 `[project] dependencies` or Poetry `[tool.poetry.dependencies]` | Optional deps excluded |
| `manifest.json` | Home Assistant integration manifest | Reads `requirements` array |
| `requirements.txt` | pip requirements format | Supports `-r` file includes |
| `setup.cfg` | `[options] install_requires` | |
| `Pipfile` | Pipenv | Reads `[packages]` only |

All matching files are parsed and merged. When the same package appears in multiple files its version constraints are combined.

### Version constraints

All standard [PEP 440](https://peps.python.org/pep-0440/) specifiers are supported: `==`, `>=`, `<=`, `>`, `<`, `!=`, `~=`, and bare package names (resolves to latest stable).

### Download statistics

Pass `--download-stats` (or `--ds`) to also fetch monthly download counts from [pypistats.org](https://pypistats.org/). Disabled by default to avoid rate-limit errors on large projects.

## GitHub URL support

Pass a GitHub repository URL instead of a local path:

```bash
node src/main.js https://github.com/owner/repo
node src/main.js https://github.com/owner/repo/tree/main
node src/main.js https://github.com/owner/repo/tree/main/subfolder
```

Ecosystem is auto-detected from the root directory listing. Python projects are traversed up to two levels deep; npm projects are read from the specified directory only.

**Authentication:** the GitHub API allows 60 unauthenticated requests/hour. Set `GITHUB_TOKEN` for private repos or to raise the limit to 5 000/hour:

```bash
GITHUB_TOKEN=ghp_... node src/main.js https://github.com/owner/private-repo
```

## Output columns

| Column | Description |
|---|---|
| Package | Package name (links to registry page in web UI) |
| Version | Resolved version |
| Released | Date the resolved version was published |
| First Release | Date the package first appeared on its registry |
| Releases | Total number of published versions |
| Downloads/mo | Python only, with `--download-stats` |
| Supply Chain | Score 0–100 % from socket.dev (requires `--socket-key` + `--socket-org`) |
| Link | Registry page URL (CLI only) |

### Color coding (CLI)

| Color | Cell | Meaning |
|---|---|---|
| Yellow | Released | Version published within the last 7 days |
| Red | First Release | Package first appeared within the last 30 days |
| Green | Supply Chain | Score ≥ 80 % |
| Yellow | Supply Chain | Score 50–79 % |
| Red | Supply Chain | Score < 50 % |

No color codes are emitted when output is piped or redirected.

### JSON output

```bash
node src/main.js <path-or-url> --json
```

```json
[
  {
    "name": "lodash",
    "version": "4.17.21",
    "released": "2021-02-20",
    "firstReleased": "2012-01-13",
    "releases": 116,
    "link": "https://www.npmjs.com/package/lodash"
  }
]
```

When `--socket-key` and `--socket-org` are provided, each entry additionally contains:

```json
{
  "supplyChainScore": 0.87
}
```

`supplyChainScore` is `null` when the package was not returned by the socket.dev API.

## Excluding test dependencies

By default the following are excluded (Python):

- **Test directories** — `test`, `tests`, `testing`, `e2e`, `integration_tests` are not traversed on GitHub.
- **Test requirement files** — `-r` includes matching `test`, `dev`, `lint`, `docs`, `ci` are skipped.
- **Poetry dev-deps** — `[tool.poetry.dev-dependencies]` and group sections.
- **Pipenv dev-packages** — `[dev-packages]` in `Pipfile`.

For npm: `devDependencies` in `package.json` and packages flagged `"dev": true` in the lock file are excluded.

Pass `--include-tests` to disable all filtering.

## Web interface

Open the browser UI with the Go server from the repo root:

```bash
npm run prepare   # creates web/src → src symlink (first time only)
go run server.go
# open http://localhost:8080/web/
go run server.go -port 9000   # custom port
go run server.go -dir ./web   # serve a different directory
```

The web UI supports the same GitHub URL formats as the CLI. It auto-detects the ecosystem and links each package to its registry page (PyPI or npmjs.com). Download statistics are not shown in the web UI because pypistats.org does not support cross-origin (CORS) requests from browsers.

### GitHub token in the web UI

Enter a personal access token in the **GitHub token** field. It is used only for `api.github.com` and never sent elsewhere. Check **Remember token** to persist it in `localStorage`.

### Socket.dev credentials in the web UI

Enter your Socket.dev API key and organisation slug in the **Socket.dev API key** and **Socket.dev org slug** fields. When both are provided, a Supply Chain column is added to the results table with scores colour-coded green (≥ 80 %), amber (50–79 %), or red (< 50 %). Check **Remember Socket.dev credentials** to persist them in `localStorage`.

## Debug mode

```bash
node src/main.js <path-or-url> --debug
```

Debug lines are prefixed with `[debug]` and always go to stderr so they don't interfere with `--json` or piped output.

## Running tests

```bash
npm test
```
