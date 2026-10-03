List **spaces** available to the caller (human-readable names) and how many
adapters each contains.

**Input**

- `include_adapter_titles` (optional) — when true, include per-space adapter
  titles and layer counts.
- `include_widget_html` (optional) — when true, load adapter titles and append a
  second tool content part with an HTML table (type badges, expandable adapter
  lists) for hosts that render HTML.

**Output:** `spaces` array with `name`, `space_id`, `type` (`personal` | `group` | `app` | `other`), `adapter_count`, and optionally `adapters` (`adapter_id`, `title`, `layer_count`).

When running in simple mode (`AUTH_ENABLED=false`), `spaces` includes both a writable **Personal** space and the read-only **Squadrules app** space.

**Collaboration patterns**

1. **Precedence** — `activate` search ties break in favour of your **default write space** (usually **Personal**). A personal fork can rank beside an identical-scoring group adapter.
2. **Scoping `activate`** — pass `space` / `space_id` using the same strings as **`train`** / **`tune`**: `"personal"`, a full group path such as `"{{SQUADRULES_GROUP_SPACE_PATH_EXAMPLE}}"` (optional `"Group: "` prefix), or the raw `space_id` from this tool.
3. **Fork** — use **`train`** with `source_adapter_uri` (`squadrules://adapter/{uuid}`) and target `space` to copy markdown into a **new** adapter UUID in another space; the original is unchanged.
4. **Move** — use **`tune`** with `space` (and optional content edits) to reassign an existing adapter’s layers to another allowed space.
5. **Visibility** — `activate` **match** choices include **`space_name`** so you can see whether a hit is personal, group, or app-level.

**SQUADRULES tool order** for runs: **`activate`** → **`forward`** (per layer until `next_action` → **`reward`**) → **`reward`**. Use this tool first when you need valid **`space`** values or an inventory before activation.
