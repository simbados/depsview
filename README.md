# depsview

Lists all dependencies and transitive dependencies of a Python project. For each package it shows the resolved version, release dates, total number of published versions, and monthly download count. All data is fetched live — no local Python installation required.

Built with [Claude Code](https://claude.ai/code).

**Data sources:** package metadata from [PyPI](https://pypi.org/), download statistics from [pypistats.org](https://pypistats.org/).

## Requirements

Node.js 18 or later. No third-party dependencies.

## Usage

```bash
node src/main.js <path-to-python-project> [--json] [--debug] [--include-tests] [--download-stats]
node src/main.js <github-url> [--json] [--debug] [--include-tests] [--download-stats]
```

**Example output:**

```
Resolving dependencies from requirements.txt (2 direct)...

Package             Version   Released     First Release  Releases  Downloads/mo
---------------------------------------------------------------------------------
certifi             2024.2.2  2024-02-02   2011-09-30     29        12,345,678
urllib3             2.2.1     2024-02-18   2008-12-28     87        34,567,890
idna                3.6       2023-11-25   2013-07-03     22        28,901,234
requests            2.31.0    2023-05-22   2011-02-14     144       56,789,012
charset-normalizer  3.3.2     2023-10-05   2021-08-16     57        18,234,567
click               8.1.7     2023-08-17   2014-06-06     72        9,876,543
---------------------------------------------------------------------------------
6 packages total  (2 direct, 4 transitive)
```

Results are sorted by release date (newest first).

### Output columns

| Column | Description |
|---|---|
| Package | Package name |
| Version | Resolved version (latest stable that satisfies the constraint) |
| Released | Date the resolved version was published |
| First Release | Date the package first appeared on PyPI |
| Releases | Total number of published versions (popularity indicator) |
| Downloads/mo | Downloads in the last 30 days from pypistats.org. Only shown with `--download-stats`. |

### Color coding

When the output is a terminal (not piped), individual date cells are highlighted:

| Color | Cell | Meaning |
|---|---|---|
| Red | First Release | Package first appeared on PyPI within the last 30 days — may be immature or untrusted |
| Yellow | Released | The resolved version was published within the last 7 days — freshly updated |

Both cells on the same row can be colored independently. No color codes are emitted when output is piped or redirected.

### JSON output

Pass `--json` to get machine-readable output without color codes:

```bash
node src/main.js <path-to-python-project> --json
```

### Download statistics

By default depsview skips the [pypistats.org](https://pypistats.org/) API call and omits the Downloads/mo column. This avoids `429 Too Many Requests` errors when resolving projects with many transitive dependencies.

Pass `--download-stats` (or the short alias `--ds`) to enable it:

```bash
node src/main.js <path-to-python-project> --download-stats
node src/main.js <github-url> --ds
```

> **Rate limit:** pypistats.org is a free, public service with no documented rate limit tier. Requests are made in batches of 5 concurrent connections. For projects with a large transitive closure the API may still return 429 errors.

### Excluding test dependencies (default)

By default depsview skips test and developer tooling dependencies so the output reflects only the runtime requirements of the project:

- **Test directories** — subdirectories named `test`, `tests`, `testing`, `e2e`, or `integration_tests` are not traversed when scanning a GitHub repository.
- **Test requirement files** — `-r` includes whose filename contains a word segment matching `test`, `tests`, `testing`, `dev`, `lint`, `docs`, or `ci` (e.g. `requirements-test.txt`, `dev-requirements.txt`, `ci.txt`) are skipped.
- **Poetry dev-deps** — `[tool.poetry.dev-dependencies]` and `[tool.poetry.group.<name>.dependencies]` sections in `pyproject.toml` are ignored.
- **Pipenv dev-packages** — `[dev-packages]` in a `Pipfile` is ignored.

Pass `--include-tests` to disable all of the above filtering and include every dependency:

```bash
node src/main.js <path-to-python-project> --include-tests
node src/main.js <github-url> --include-tests
```

### Debug mode

Pass `--debug` to print API errors and warnings to stderr while fetching. Useful when a package shows `-` for Downloads/mo or an unexpected version is resolved:

```bash
node src/main.js <path-to-python-project> --debug
```

Debug output lines are prefixed with `[debug]` and always go to stderr, so they do not interfere with `--json` output or piped table output. Both flags can be combined:

```bash
node src/main.js <path-to-python-project> --json --debug
```

```json
[
  {
    "name": "requests",
    "version": "2.31.0",
    "released": "2023-05-22",
    "firstReleased": "2011-02-14",
    "releases": 144,
    "downloadsLastMonth": 56789012
  }
]
```

`downloadsLastMonth` is `null` when pypistats.org has no data for that package.

## GitHub URL support

Pass a GitHub repository URL instead of a local path to analyse a remote project without cloning it:

```bash
node src/main.js https://github.com/owner/repo
node src/main.js https://github.com/owner/repo/tree/main
node src/main.js https://github.com/owner/repo/tree/main/subfolder
```

depsview searches the target directory and up to **two levels of subdirectories** for dependency files. This means root-level files (`pyproject.toml`, `requirements.txt`, …) and nested files such as a Home Assistant `custom_components/<integration>/manifest.json` are all discovered and merged into a single run.

When the same package is declared in more than one file its version constraints are combined (e.g. `>=2.28` from `pyproject.toml` and `<3.0` from `requirements.txt` become `>=2.28,<3.0`).

**Authentication:** the GitHub API allows 60 unauthenticated requests per hour. For private repositories or to increase the limit to 5 000 requests/hour, set the `GITHUB_TOKEN` environment variable:

```bash
GITHUB_TOKEN=ghp_... node src/main.js https://github.com/owner/private-repo
```

## Supported dependency file formats

depsview finds all of the following files and parses every one it finds:

| File | Format | Notes |
|---|---|---|
| `pyproject.toml` | PEP 621 `[project] dependencies` or Poetry `[tool.poetry.dependencies]` | Optional dependencies are excluded |
| `manifest.json` | Home Assistant integration manifest | Reads the `requirements` array |
| `requirements.txt` | pip requirements format | Supports `-r` file includes |
| `setup.cfg` | `[options] install_requires` | |
| `Pipfile` | Pipenv | Reads `[packages]` only |

All matching files are parsed and their dependency lists are merged.

### Version constraints

All standard [PEP 440](https://peps.python.org/pep-0440/) version specifiers are supported:

| Specifier | Example | Meaning |
|---|---|---|
| `==` | `requests==2.31.0` | Exact version |
| `>=` | `requests>=2.28.0` | Minimum version |
| `<=`, `>`, `<` | `click<9.0` | Upper/lower bounds |
| `!=` | `requests!=2.29.0` | Exclude a version |
| `~=` | `requests~=2.28.1` | Compatible release |
| *(none)* | `requests` | Latest stable version |

Comma-separated constraints (`>=2.28.0,<3.0.0`) are also supported. When no exact version is specified, depsview resolves the latest stable (non-pre-release) version that satisfies all constraints.

## Web interface

A browser-based UI is available in the `web/` directory. It calls the GitHub and PyPI APIs directly from the browser — no server-side component or Node.js installation is required.

Open it with the included Go server from the repo root:

```bash
go run server.go
# then open http://localhost:8080/web/
go run server.go -port 9000   # custom port
```

> **Note:** the page must be served over HTTP (not opened as a `file://` URL) so that browser security policies allow the ES module imports across directories.

The web UI supports the same GitHub URL formats as the CLI with checkboxes for including test/dev dependencies and fetching download statistics. Only the target directory and up to two levels of subdirectories are scanned for dependency files. The results table shows Package, Version, Released, First Release, and Releases columns (plus Downloads/mo when download statistics are enabled) with the same colour coding as the CLI.

## Running tests

```bash
npm test
```

