// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
# mime-artifact-sample

This fixture is the byte-level contract for MIME artifact end-to-end export
parity tests.

It contains one non-markdown artifact for each currently allowed train MIME,
plus valid adapter markdown in `SKILL.md`.

## fixture layout

Use this directory as the skill root during fixture-driven tests.

| Path | Purpose |
| --- | --- |
| `artifact-contract.json` | Canonical ordered artifact paths, MIME map, and expected train slugs for tests and `scripts/dev-mime-fixture-train-export.mjs`. |
| `SHA256SUMS` | GNU-style checksums for this fixture. Run `shasum -a 256 -c SHA256SUMS` from this directory. |
| `SKILL.md` | Adapter markdown input for `POST /api/train/raw` or MCP `train`. |
| `notes.txt` | Artifact source for `text/plain`. |
| `conf/app-config.toml`, `conf/routes.yaml` | Artifact sources for `text/x-toml` and `text/yaml`. |
| `scripts/hello.*` | Artifact sources for `text/x-python`, `text/x-shellscript`, `text/javascript`, and `text/x-perl`. |

## byte contract

The fixture files are train-input bytes.

- Artifact files in this fixture must not carry trailing whitespace or trailing
  newline bytes.
- `SHA256SUMS` uses bytewise path sort order to match export behavior.
- `SHA256SUMS` is expected to pass `shasum -a 256 -c` from this directory.

Stage 0 export contract:

- The seven non-markdown artifact rows in exported `<slug>/SHA256SUMS` must
  match the corresponding rows in this fixture.
- The `SKILL.md` row can differ at Stage 0 because export regenerates markdown
  shape (`buildSkillMdFile`), and this is expected.

Stage 1+ export contract:

- Retraining from Stage 0 output and exporting again must produce a
  byte-identical `SHA256SUMS` body across rounds, including the `SKILL.md` row.

## on-disk export dumps from integration tests

Mime export parity tests **always** mirror each parsed bundle under the repo’s
**`.local/mime-fixture-export/`** (gitignored). The first of those test files to load on a Jest
worker removes that directory and recreates it empty **in `beforeAll`** (i.e. when tests start,
not during `npm run dev:deploy`), so stale dumps are not mixed with the current run. Writes are
part of the test contract: if the tree cannot be created, the test fails. Layout:
**`.local/mime-fixture-export/<pid>/<api|mcp|cli>/<skill_tree|skill_zip>/stage<0|1|2>/`**
(`<pid>` is the Jest worker process id so parallel runs do not overwrite each other). Each
folder contains the exported files, **`SHA256SUMS.exported`**, and **`export-dump-meta.json`**.
Override the root with **`KAIROS_MIME_FIXTURE_EXPORT_DIR`** if you want a different base path.

## train inputs

Prefer **`artifact-contract.json`** as the single list of paths and MIME types;
the table below mirrors that file for human readers.

Attach non-markdown files through `POST /api/train` JSON (or MCP `train`) with
`mime`, `artifact_name`, `adapter_uri`, and `content` read from the paths
listed below.

Set `KAIROS_MIME_SAMPLE_ROOT` to this directory when running scripts from
another working directory.

| Source file | `mime` for artifact train |
| --- | --- |
| `scripts/hello.py` | `text/x-python` |
| `scripts/hello.sh` | `text/x-shellscript` |
| `scripts/hello.cjs` | `text/javascript` |
| `scripts/hello.pl` | `text/x-perl` |
| `conf/app-config.toml` | `text/x-toml` |
| `conf/routes.yaml` | `text/yaml` |
| `notes.txt` | `text/plain` |
