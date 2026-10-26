# Known issues and limitations

Expected behaviour that looks like a defect. Each entry records what you see,
why it happens, and what would actually change it, so the same finding is not
re-diagnosed on every install.

## `npm install` warns that `@anush008/tokenizers` is deprecated

**What you see.** An install in this repository — `npm ci` locally, the
devcontainer's `postCreateCommand`, CI — prints this as its first line, before
any other output:

```text
npm warn deprecated @anush008/tokenizers@0.6.0: This package has been archived. Please use the official and updated "huggingface/tokenizers" package.
```

**Why it happens.** The package is not one of our dependencies. It is transitive:
`fastembed@3.0.0` declares `@anush008/tokenizers: ^0.0.0`, which resolves to
exactly `0.0.0`, a release with no `linux-arm64` binaries. Our root `overrides`
entry pins that transitive to a version that does carry them — see
[ADR 0030](adr/0030-tokenizers-arm64-native-binding-override.md) for that
decision and the platform matrix behind it. The publisher archived the package,
so the deprecation notice is attached to every published version (`0.0.0`,
`0.2.0`, `0.5.0`, `0.6.0`); there is no non-deprecated release to move to.

**Why changing our version does not fix it.** An `overrides` value is read only
from the root package being installed. Bumping, widening, or removing this entry
cannot change what `npm install @squadrules/mcp` resolves for anyone else: a
consumer's install follows `fastembed`'s own `^0.0.0` range, reports the notice
for `0.0.0`, and lacks the arm64 binding unless the consumer pins its own
override.

**What would actually change it.** Either:

- `fastembed` moves to an official binding — the only change upstream can make
  that clears the notice; or
- this repository stops depending on `fastembed` and owns the local embedding
  path on official components. Evaluated 2026-10-26: `tokenizers@0.23.2`
  exposes the members `fastembed` calls here — `Tokenizer.fromFile`,
  `setTruncation`, `setPadding`, `addSpecialTokens`, `addAddedTokens`,
  `AddedToken`, `encode`, and the `getIds`/`getAttentionMask`/`getTypeIds`
  accessors — so it could stand in for the archived binding behind our own
  provider. A root override to it only helps this repository, though, and
  unpacks 66 MB of all-platform binaries into `node_modules`.
  `@huggingface/tokenizers@0.2.0`, the package the notice points at, is pure JS
  (≈361 kB unpacked over 80 files) and its API differs from `fastembed`'s call
  shape, so it is not a drop-in either.

Raising `fastembed`'s own floor is not on that list. Every published version
carries the notice, so a higher floor only resolves to a different deprecated
release; it would make our override redundant, and nothing more. The version and
size figures above are registry facts as of 2026-10-26 — re-measure them before
acting on them.

**Status.** Expected, not a regression. Do not re-report it without one of the
two triggers above. Background: issues
[#77](https://github.com/SquadRules/mcp/issues/77) and
[#173](https://github.com/SquadRules/mcp/issues/173), both closed.
