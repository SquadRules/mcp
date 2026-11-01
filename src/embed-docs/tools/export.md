Export an **adapter**, a single **layer**, an **artifact** (`source`), or a **skill-shaped bundle** for backup, inspection, training pipelines, or portable skill distribution.

**When to call:** Whenever you need an adapter's **own files** rather than its
instructions — its Markdown document, the `artifacts/` scripts its `shell`
contracts invoke, or a portable bundle. `activate` and `forward` return *what to
do*; **`export` returns the files themselves**. Call it before running a contract
whose command names a script path, and before shipping an adapter that ships one.

**Input**

- **Selection** — exactly one of:
  - **`uri`** — `squadrules://adapter/{uuid|slug}`, `squadrules://layer/{uuid}` (optional `execution_id` on layer URIs where applicable), or `squadrules://artifact/{uuid|slug}` for source/artifact payloads.
  - **`adapters`** — non-empty array of adapter identifiers (full URIs and/or bare slugs). Produces one bundle with one top-level folder per exported skill **slug** (capped per server policy).
  - **`all_adapters: true`** with **`space_name`** — export every adapter in that space (human-readable space **name**, not a raw space id).
- **`format`** (optional) — default **`skill_zip`** (skill-shaped ZIP delivered through **`download_ref`** by default). Other values:
  - **`markdown`** — flat serialized adapter Markdown (smallest payload for **`tune`** or a quick local file). A single **`uri`** returns the content inline; an **`adapters`**/**`all_adapters`** selection requires **`directory`** (see below). Prefer **`skill_tree`** / **`skill_zip`** for portable **`SKILL.md` + `artifacts/` + integrity.
  - **`skill_tree`** — JSON tree of generated files (paths and UTF-8 contents).
  - **`trace_jsonl`**, **`reward_jsonl`**, **`sft_jsonl`**, **`preference_jsonl`** — training datasets (single **`uri`** only).
  - **`source`** — artifact listing or payload (single **`uri`**). `content` is raw UTF-8 text unless **`delivery: inline_base64`** asks for the same bytes base64-encoded; **`sha256`** names the digest of those bytes either way.
- **`include_reward`** (optional, default **`true`**) — include reward fields when serializing **`trace_jsonl`**. **`reward_jsonl`** always serializes reward data and skips unrewarded executions.
- **`delivery`** (optional, **`skill_zip`** and **`source`** only) — for **`skill_zip`**, default **`download_ref`** returns compact JSON with a short-lived download URL; use **`inline_base64`** only when the ZIP must be embedded in the JSON response. For **`source`**, **`inline_base64`** is the materialization path: base64 survives a JSON response and a shell variable without changing a byte, so decoding it into a file reproduces the stored artifact exactly.
- **`directory`** (optional) — absolute path of a directory on the machine running the export; SIMPLE/stdio mode only (CLI: local mode). Each selected adapter is written as **`<directory>/<slug>.md`** and the response carries **`directory_manifest`** (per-file `slug`, `path`, `bytes`, `status`) instead of inline `content`. Required for **`format: markdown`** with an **`adapters`**/**`all_adapters`** selection. The path must be inside the allowed export directories (**`SQUADRULES_ALLOWED_EXPORT_DIRS`**; defaults include the server's working directory).

**Output:** `content` (string), `content_type`, `format`, optional `item_count`, adapter metadata. **`source`** responses also carry **`sha256`** — the digest of the bytes `content` holds, before decoding — so you can tell a stale artifact from a mangled write. Default **`skill_zip`** responses set **`download_ref`** with `url`, `expires_at`, `filename`, and `content_type`; fetch the URL with **`curl -fLOJ`** or equivalent to get ZIP bytes. **`inline_base64`** responses may set **`content_encoding: "base64"`**, **`bundle_sha256`**, **`skill_bundle_manifest`** (JSON string), and **`export_adapter_count`**. Server operators may set **`SQUADRULES_EXPORT_ZIP_COMPRESSION_LEVEL`** (**0**–**9**, default **6**) to tune **`skill_zip`** CPU vs size (**0** = store-only; **9** = slowest, smallest).

**HTTP bytes:** **`POST /api/export`** returns JSON for **`skill_zip`**. ZIP bytes are served only by **`GET /export/skill-zip/{opaque}`** from **`download_ref.url`**.

**Skill-shaped export:** Serialized tree uses **`contract`** in JSON fences (not `challenge`), **Activation Patterns** / **Reward Signal** headings where applicable, and optional **`<slug>/artifacts/`** files from storage. Each **`<slug>/`** folder also contains **`SHA256SUMS`** (GNU **`sha256sum`** text, paths relative to that folder) listing **`SKILL.md`** and every **`artifacts/`** file. **`skill_tree`** includes a per-skill **`diagnostics`** array (for example extension vs MIME warnings on attached files, or **`artifact_stored_sha_mismatch`** when a stored artifact digest disagrees with exported bytes).

**Training formats:** **`reward_jsonl`** emits only rows with stored reward data. **`sft_jsonl`** and **`preference_jsonl`** apply their export gates. Ungraded rewards stay in **`trace_jsonl`** but are excluded from model-training formats where documented.

**RFT gate:** `rft_jsonl` is intentionally not exposed yet.

**Use with `tune`:** Edit **flat** exported Markdown, then **`tune`** with matching `uris` / `content`. Obtain flat Markdown via **`format: markdown`** (single adapter or layer **`uri`**).

**Local install (agents):** **`export`** is also used to **mirror** stored content for execution (scripts under **`artifacts/`**, **`SHA256SUMS`** checks). For a **full** tree, use **`skill_zip`** and unzip; a **canonical** install root on the same machine as the CLI config is **`$XDG_CONFIG_HOME/squadrules/skills/<slug>/`** (Unix; see `getSquadrulesSkillInstallDirForSlug` in server sources / the Artifact Management topic in the [project Wiki](https://github.com/jakub-plichcinski/squadrules-mcp/wiki)). For **only** the adapter document, **`format: markdown`** and write **`content`** to your chosen path under that tree or the workspace.

**Missing script:** If a `shell` contract names a script you cannot find, export
that adapter and look for it — **`format: skill_tree`** returns a JSON file list
(**`skills[].files[].path`**), **`format: skill_zip`** returns the bundle. The
script belongs under **`artifacts/`** at the path the contract invokes.
**`skill_tree`** also returns **`skills[].diagnostics[]`**: treat
**`artifact_stored_sha_mismatch`** (the stored digest disagrees with the exported
bytes) and **`artifact_relative_path_invalid`** (the artifact path was ignored and
replaced by a default) as a **broken artifact**, not a pass.
