// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
---
name: mime-artifact-sample
description: Sample adapter with one artifact per allowed non-markdown MIME type
---

# MIME artifact sample

## Activation Patterns

Minimal fixture for MIME coverage. Skill root = this directory (`SKILL.md`, `notes.txt`, `conf/`, `scripts/`).

The next four layers each run **one** bundled script via a **`shell`** contract: **`interpreter`**, **`flags`** / **`args`** where useful, **`cmd`**, **`timeout_seconds`**. Success is **exit code 0** only (no `grep`). Run **`forward`** from the skill root as cwd (or set `KAIROS_MIME_SAMPLE_ROOT` to this directory).

**Must Never**

- Store secrets in these fixtures.

```json
{"contract":{"type":"comment","comment":{"min_length":10},"required":true}}
```

## Run hello.py (python3)

Layer text: run the Python artifact with **`python3`**, **`-B`**, and pass the script path via **`args`** (same argv shape the server builds for `interpreter` + `-c` + trailing args).

```json
{"contract":{"type":"shell","required":true,"shell":{"interpreter":"python3","flags":["-B"],"args":["scripts/hello.py"],"timeout_seconds":25,"cmd":"import subprocess, sys; sys.exit(subprocess.run([sys.executable, sys.argv[1]], check=False).returncode)"}}}
```

## Run hello.sh (sh)

Layer text: run the shell artifact with **`sh`** as interpreter; **`cmd`** is a one-line script that invokes `scripts/hello.sh` so `$0` inside the file stays correct.

```json
{"contract":{"type":"shell","required":true,"shell":{"interpreter":"sh","timeout_seconds":20,"cmd":"sh scripts/hello.sh"}}}
```

## Run hello.cjs (node)

Layer text: run the JavaScript artifact with **`node`** as interpreter; **`cmd`** is a one-liner that **`spawnSync`** the same binary on `scripts/hello.cjs`.

```json
{"contract":{"type":"shell","required":true,"shell":{"interpreter":"node","timeout_seconds":25,"cmd":"require('child_process').spawnSync('node', ['scripts/hello.cjs'], {stdio: 'inherit'}).status && process.exit(1)"}}}
```

## Run hello.pl (perl)

Layer text: run the Perl artifact with **`perl`** and **`-w`** in **`flags`**; **`cmd`** runs `scripts/hello.pl` via **`system`** and exits with the child status.

```json
{"contract":{"type":"shell","required":true,"shell":{"interpreter":"perl","flags":["-w"],"timeout_seconds":20,"cmd":"system($^X, 'scripts/hello.pl'); exit($? >> 8)"}}}
```

## Reward Signal

All four script layers completed with exit code 0.

```json
{"contract":{"type":"comment","comment":{"min_length":5},"required":true}}
```
