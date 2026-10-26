# Example: Multi-step gate shipped as an artifact

Short adapter example: one `shell` contract whose check has several conditions, kept out of the markdown as a **gate script artifact**. A `shell` contract's `cmd` is program text for every interpreter — `bash`/`sh` and `python3`/`python` receive it via `-c`, `node` via `-e` — so an inline multi-step program has to be escaped into one line, which is unreadable, untestable, and impossible for a reviewer to audit. Ship the script instead and invoke it.

The companion script is [artifact-gate-check.py](artifact-gate-check.py). It carries a `# squadrules-artifact:` header, so its identity (`slug: artifact-gate-check`) is pinned the same way a contract pins its adapter.

## Activation Patterns

Run when user says "example artifact gate" or "run the preflight gate".

## Step 1 — Run the preflight gate

First attach the script to this adapter (one extra `train` call — artifacts are attached to an **existing** adapter, so the adapter markdown must be trained first):

```bash
squadrules train ./artifact-gate-check.py \
  --adapter squadrules://adapter/example-artifact-gate \
  --artifact-name artifact-gate-check.py \
  --mime text/x-python --model <model-id>
```

Then `activate` the adapter and confirm `linked_artifacts[].relative_path` equals `artifacts/artifact-gate-check.py` — that is the path the contract below invokes. Before running the contract, run the row's `materialize` command; it writes the script into `$SQUADRULES_LOCAL_ARTIFACT_DIR` and verifies its `sha256`.

Read the path from `activate`, never assume it: a directory `train` batch derives `relative_path` from the batch root instead, so the same script lands at a different path. The default `artifacts/<name>` layout applies to single-file `--adapter` trains like the one above.

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

## Reward Signal

Only reachable after all prior steps are solved.

## Why this shape

- **One artifact, many gates.** The same script serves every gate of this adapter and every other adapter that attaches it: `--gate preflight`, `--gate commit`, `--gate pr`. Ambiguous multistep logic does not get re-typed inline per contract, and a fix to the gate fixes every caller.
- **The contract stays auditable.** A reviewer reads one line and knows which script runs and which gate.
- **The check is testable on its own.** Run `python3 artifact-gate-check.py --gate preflight` without SquadRules to reproduce a failure.
- **Re-train, do not re-inline.** When the checks change, `train` the script again with the same `slug` header; the artifact is replaced in place and existing contracts keep working.
