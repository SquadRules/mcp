# Known issues and limitations

Expected behaviour that looks like a defect. Each entry records what you see,
why it happens, and what would actually change it, so the same finding is not
re-diagnosed on every install.

## Retired: `npm install` warns that `@anush008/tokenizers` is deprecated

Retired 2026-11-18 by issue [#252](https://github.com/SquadRules/mcp/issues/252)
and [ADR 0041](adr/0041-transformersjs-local-embedding-runtime-and-equivalence-tolerance.md):
the local embedding runtime is now `@huggingface/transformers`, whose tokenizer
(`@huggingface/tokenizers`) is pure JS. Neither this repository nor consumer
installs resolve `fastembed` or `@anush008/tokenizers` anymore, so the archived
package's deprecation notice is gone and the
[ADR 0030](adr/0030-tokenizers-arm64-native-binding-override.md) arm64 override
is superseded. The consumer-tree assertions in `scripts/ci-test-tgz-install.mjs`
(build lane, `npm run test:tgz`) keep this retired: a consumer install fails the
gate if `fastembed`, `@anush008/tokenizers`, or `boolean@3.2.0` reappears.
Background: issues [#77](https://github.com/SquadRules/mcp/issues/77) and
[#173](https://github.com/SquadRules/mcp/issues/173), both closed.

## Intel macOS: no native local embedding inference

**What you see.** On Intel Macs (darwin-x64) the default key-free local
embedding provider fails to load its native ONNX runtime. Apple Silicon
(darwin-arm64) is verified working.

**Why it happens.** `@huggingface/transformers@4.3.2` pins
`onnxruntime-node@1.30.0`, which ships darwin-arm64 only among macOS prebuilds
(the 1.21.0 line used by the retired fastembed also shipped darwin-x64).
[ADR 0041](adr/0041-transformersjs-local-embedding-runtime-and-equivalence-tolerance.md)
Decision 7 records this as an accepted regression of the swap.

**Workaround.** Configure an external embedding provider
(`OPENAI_API_KEY` + `OPENAI_EMBEDDING_MODEL`, or `TEI_BASE_URL` + `TEI_MODEL`);
provider selection prefers a configured external provider over the local
default, on every platform.

**What would actually change it.** An upstream `onnxruntime-node` release that
ships darwin-x64 prebuilds again, or a productized WASM fallback (explicitly out
of scope in ADR 0041). Re-measure before acting on either.

## musl (Alpine) and Android/bionic: local embedding unsupported

**What you see.** On Alpine/musl the local provider fails at native load (for
example `ld-linux-aarch64.so.1: No such file or directory`); on Android/bionic
(Termux) no native binding loads at all.

**Why it happens.** `onnxruntime-node` ships glibc Linux prebuilds only
(x64/arm64) — no musl or bionic binaries, exactly as with the retired fastembed
chain (ADR 0041 Decision 7). `sharp` supports musl but not Android; that does
not lift the ONNX limitation.

**Workaround.** Use a glibc-based image (the devcontainer is glibc for this
reason; see `tests/scripts/devcontainer.test.mjs`) or configure an external
embedding provider as above.