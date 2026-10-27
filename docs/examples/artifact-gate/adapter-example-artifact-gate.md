---
slug: example-artifact-gate
---

# Example: Multi-step gate shipped as an artifact

Short adapter example: one `shell` contract whose check has several conditions, kept out of the markdown as a **gate script artifact**. `cmd` is program text rather than a file path for every interpreter — the full rule and field names are in [contract types](../challenge-types.md), the decision in [ADR 0033](../../adr/0033-gate-scripts-as-adapter-artifacts.md).

The frontmatter `slug` pins the adapter URI to `squadrules://adapter/example-artifact-gate`, which is what the artifact `train` below targets.

The companion script is [artifact-gate-check.py](artifact-gate-check.py). It carries a `# squadrules-artifact:` header, so its identity (`slug: artifact-gate-check`) is pinned the same way a contract pins its adapter.

## Activation Patterns

Run when user says "example artifact gate" or "run the preflight gate".

## Step 1 — Run the preflight gate

If `activate` already shows `artifacts/artifact-gate-check.py` in `linked_artifacts[]`, skip this train — the artifact is attached. Otherwise attach the script via the MCP `train` tool (artifacts attach to an **existing** adapter, so the adapter markdown must be trained first). `force_update: true` makes the call safe on re-runs:

```json
{
  "content": "<contents of artifact-gate-check.py>",
  "llm_model_id": "<model-id>",
  "adapter_uri": "squadrules://adapter/example-artifact-gate",
  "artifact_name": "artifact-gate-check.py",
  "mime": "text/x-python",
  "force_update": true
}
```

Then `activate` the adapter and confirm `linked_artifacts[].relative_path` equals `artifacts/artifact-gate-check.py` — that is the path the contract below invokes. Before running the contract, run the row's `materialize` command; it writes the script into `$SQUADRULES_LOCAL_ARTIFACT_DIR` and verifies its `sha256`.

Read the path from `activate`, never assume it — the two train layouts differ ([ADR 0033 §7](../../adr/0033-gate-scripts-as-adapter-artifacts.md)).

The contract itself stays one line. `interpreter` names the wrapper that runs that line, not the language of the script:

```json
{
  "contract": {
    "type": "shell",
    "shell": {
      "interpreter": "bash",
      "cmd": "python3 \"$SQUADRULES_LOCAL_ARTIFACT_DIR/artifacts/artifact-gate-check.py\" --gate preflight",
      "timeout_seconds": 60
    },
    "required": true
  }
}
```

The gate passes when all of its conditions pass and the script exits 0; on failure it prints one `FAIL: …` line per unmet condition to stderr and exits 1.

## Step 2 — Run complete

Only reachable after Step 1 is solved. Show the output from Step 1 to the user (exit code, stdout, stderr if any). No additional challenge.

## Why this shape

- **One artifact, many gates.** The script dispatches on `--gate`, so adding a second gate is one entry in its `GATES` map instead of another inline program in the markdown, and every adapter that attaches the artifact gets that gate. This example ships `preflight`; a `commit` or `pr` gate would be added the same way. Ambiguous multistep logic does not get re-typed inline per contract, and a fix to the gate fixes every caller.
- **The contract stays auditable.** A reviewer reads one line and knows which script runs and which gate.
- **The check is testable on its own.** Run `python3 artifact-gate-check.py --gate preflight` without SquadRules to reproduce a failure.
- **Re-train, do not re-inline.** When the checks change, call `train` again with the same `slug` header **and** `force_update: true`. The header slug makes the re-train match the existing artifact, and the force flag replaces it in place; without it `train` refuses with `Artifact "…" already exists on this adapter`, and existing contracts keep working either way.

## Reward Signal

Only reachable after all prior steps are solved.
