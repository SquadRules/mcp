Remove adapters or individual layers by URI.

**Input**

- `uris` — non-empty array of `squadrules://adapter/{uuid}` or
  `squadrules://layer/{uuid}`.

**Behavior**

- **Adapter URI** — deletes **all** layers belonging to that adapter.
- **Layer URI** — deletes that layer memory only.

**Output:** Per-URI `status` (`deleted` | `error`), `message`, and aggregate counts.

**Warning:** Deletion is destructive. Prefer **`export`** before removing production adapters.
