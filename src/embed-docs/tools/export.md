// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
Export an **adapter**, a single **layer**, an **artifact** (`source`), or a **skill-shaped bundle** for backup, inspection, training pipelines, or portable skill distribution.

**Input**

- **Selection** — exactly one of:
  - **`uri`** — `kairos://adapter/{uuid|slug}`, `kairos://layer/{uuid}` (optional `execution_id` on layer URIs where applicable), or `kairos://artifact/{uuid|slug}` for source/artifact payloads.
  - **`adapters`** — non-empty array of adapter identifiers (full URIs and/or bare slugs). Produces one bundle with one top-level folder per exported skill **slug** (capped per server policy).
  - **`all_adapters: true`** with **`space_name`** — export every adapter in that space (human-readable space **name**, not a raw space id).
- **`format`** (optional) — default **`skill_zip`** (skill-shaped ZIP delivered through **`download_ref`** by default). Other values:
  - **`markdown`** — flat serialized adapter Markdown (single **`uri`** only; smallest payload for **`tune`** or a quick local file). Prefer **`skill_tree`** / **`skill_zip`** for portable **`SKILL.md` + `artifacts/` + integrity.
  - **`skill_tree`** — JSON tree of generated files (paths and UTF-8 contents).
  - **`trace_jsonl`**, **`reward_jsonl`**, **`sft_jsonl`**, **`preference_jsonl`** — training datasets (single **`uri`** only).
  - **`source`** — artifact listing or payload (single **`uri`**).
- **`include_reward`** (optional, default **`true`**) — include reward fields when serializing **`trace_jsonl`**. **`reward_jsonl`** always serializes reward data and skips unrewarded executions.
- **`delivery`** (optional, **`skill_zip`** only) — default **`download_ref`** returns compact JSON with a short-lived download URL. Use **`inline_base64`** only when the ZIP must be embedded in the JSON response.

**Output:** `content` (string), `content_type`, `format`, optional `item_count`, adapter metadata. Default **`skill_zip`** responses set **`download_ref`** with `url`, `expires_at`, `filename`, and `content_type`; fetch the URL with **`curl -fLOJ`** or equivalent to get ZIP bytes. **`inline_base64`** responses may set **`content_encoding: "base64"`**, **`bundle_sha256`**, **`skill_bundle_manifest`** (JSON string), and **`export_adapter_count`**. Server operators may set **`KAIROS_EXPORT_ZIP_COMPRESSION_LEVEL`** (**0**–**9**, default **6**) to tune **`skill_zip`** CPU vs size (**0** = store-only; **9** = slowest, smallest).

**HTTP bytes:** **`POST /api/export`** returns JSON for **`skill_zip`**. ZIP bytes are served only by **`GET /export/skill-zip/{opaque}`** from **`download_ref.url`**.

**Skill-shaped export:** Serialized tree uses **`contract`** in JSON fences (not `challenge`), **Activation Patterns** / **Reward Signal** headings where applicable, and optional **`<slug>/artifacts/`** files from storage. Each **`<slug>/`** folder also contains **`SHA256SUMS`** (GNU **`sha256sum`** text, paths relative to that folder) listing **`SKILL.md`** and every **`artifacts/`** file. **`skill_tree`** includes a per-skill **`diagnostics`** array (for example extension vs MIME warnings on attached files, or **`artifact_stored_sha_mismatch`** when a stored artifact digest disagrees with exported bytes).

**Training formats:** **`reward_jsonl`** emits only rows with stored reward data. **`sft_jsonl`** and **`preference_jsonl`** apply their export gates. Ungraded rewards stay in **`trace_jsonl`** but are excluded from model-training formats where documented.

**RFT gate:** `rft_jsonl` is intentionally not exposed yet.

**Use with `tune`:** Edit **flat** exported Markdown, then **`tune`** with matching `uris` / `content`. Obtain flat Markdown via **`format: markdown`** (single adapter or layer **`uri`**).

**Local install (agents):** **`export`** is also used to **mirror** stored content for execution (scripts under **`artifacts/`**, **`SHA256SUMS`** checks). For a **full** tree, use **`skill_zip`** and unzip; a **canonical** install root on the same machine as the CLI config is **`$XDG_CONFIG_HOME/kairos/skills/<slug>/`** (Unix; see `getSquadrulesSkillInstallDirForSlug` in server sources / the Artifact Management topic in the [project Wiki](https://github.com/jakub-plichcinski/kairos-mcp/wiki)). For **only** the adapter document, **`format: markdown`** and write **`content`** to your chosen path under that tree or the workspace.
