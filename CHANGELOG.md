# Changelog

## [5.14.7](https://github.com/SquadRules/mcp/compare/v5.14.6...v5.14.7) (2026-10-31)


### Bug Fixes

* **cli:** export markdown bulk via --directory with slug-named files ([faeb30f](https://github.com/SquadRules/mcp/commit/faeb30f6c8ad39343ba7b29a6941ba4ca838f3b4))
* **cli:** export markdown bulk via --directory, slug filenames ([#240](https://github.com/SquadRules/mcp/issues/240)) ([faeb30f](https://github.com/SquadRules/mcp/commit/faeb30f6c8ad39343ba7b29a6941ba4ca838f3b4))

## [5.14.6](https://github.com/SquadRules/mcp/compare/v5.14.5...v5.14.6) (2026-10-31)


### Bug Fixes

* **dependencies:** pin undici 8.12.3 in production dependencies ([#238](https://github.com/SquadRules/mcp/issues/238)) ([ef4adec](https://github.com/SquadRules/mcp/commit/ef4adec5210da58e964158c95bdafdddb4d73290)), closes [#234](https://github.com/SquadRules/mcp/issues/234)

## [5.14.5](https://github.com/SquadRules/mcp/compare/v5.14.4...v5.14.5) (2026-10-31)


### Bug Fixes

* **packaging:** publish tested runtime lock for application-root consumers ([#237](https://github.com/SquadRules/mcp/issues/237)) ([27e115b](https://github.com/SquadRules/mcp/commit/27e115be7d80a073d6bb571e3ea190da0b622527))

## [5.14.4](https://github.com/SquadRules/mcp/compare/v5.14.3...v5.14.4) (2026-10-31)


### Bug Fixes

* **cli:** local-mode skill_zip export delivers inline base64 ([#233](https://github.com/SquadRules/mcp/issues/233)) ([84a429f](https://github.com/SquadRules/mcp/commit/84a429f17c60522399e0c834bebae1832544c5ba))
* **cli:** make local-mode skill_zip export deliver inline base64 bytes ([84a429f](https://github.com/SquadRules/mcp/commit/84a429f17c60522399e0c834bebae1832544c5ba))
* **test:** fresh-checkout source lane compiles, boot errors unmasked ([#235](https://github.com/SquadRules/mcp/issues/235)) ([15f851e](https://github.com/SquadRules/mcp/commit/15f851ecb8083a24d2a5b129b4f2c092efe2b93e))
* **test:** make fresh-checkout source-mode lane compile and unmask boot errors ([15f851e](https://github.com/SquadRules/mcp/commit/15f851ecb8083a24d2a5b129b4f2c092efe2b93e)), closes [#204](https://github.com/SquadRules/mcp/issues/204)

## [5.14.3](https://github.com/SquadRules/mcp/compare/v5.14.2...v5.14.3) (2026-10-31)


### Bug Fixes

* **dependencies:** pin typescript to ^5.9.3 to avoid vulnerable Go binary ([#229](https://github.com/SquadRules/mcp/issues/229)) ([89e40b1](https://github.com/SquadRules/mcp/commit/89e40b1f2c13c4d02942b72b79cbbcc454249a17))

## [5.14.2](https://github.com/SquadRules/mcp/compare/v5.14.1...v5.14.2) (2026-10-31)


### Bug Fixes

* **ci:** recover audited glob and minimatch overrides ([#226](https://github.com/SquadRules/mcp/issues/226)) ([930a213](https://github.com/SquadRules/mcp/commit/930a21326be81c947bda212eccdce79a2ddc96b8))
* **deps:** resolve npm security advisories ([#227](https://github.com/SquadRules/mcp/issues/227)) ([197e320](https://github.com/SquadRules/mcp/commit/197e3208f8b1a163829d6ddf7301e3f7b5b04307))

## [5.14.1](https://github.com/SquadRules/mcp/compare/v5.14.0...v5.14.1) (2026-10-30)


### Bug Fixes

* **activate:** replace shell materialize command with MCP export tool instruction ([#223](https://github.com/SquadRules/mcp/issues/223)) ([7d66228](https://github.com/SquadRules/mcp/commit/7d66228e6d635b8dff23eacb9dce0053350c6241))

## [5.14.0](https://github.com/SquadRules/mcp/compare/v5.13.8...v5.14.0) (2026-10-30)


### Features

* **agent:** give the task-isolation rule its own verified mechanism ([#217](https://github.com/SquadRules/mcp/issues/217)) ([afeac1f](https://github.com/SquadRules/mcp/commit/afeac1fb6c1514de4d6007bb1c8f67da9a5a7874))


### Bug Fixes

* **agent:** keep the isolation worktree owned when the fast-forward fails ([#218](https://github.com/SquadRules/mcp/issues/218)) ([58eb8c5](https://github.com/SquadRules/mcp/commit/58eb8c50c5be82d8f12070d91ceeac696edca4cd))
* **tools:** clarify contract rendering and honest verification ([#216](https://github.com/SquadRules/mcp/issues/216)) ([#220](https://github.com/SquadRules/mcp/issues/220)) ([1b74840](https://github.com/SquadRules/mcp/commit/1b7484046250161ec29b9460ee16159199411633))

## [5.13.8](https://github.com/SquadRules/mcp/compare/v5.13.7...v5.13.8) (2026-10-28)


### Bug Fixes

* **activate:** make artifact materialize executable and run the critic in a subagent ([#188](https://github.com/SquadRules/mcp/issues/188)) ([7771a4d](https://github.com/SquadRules/mcp/commit/7771a4d06c63c8fcfeacf9ed300b5f760f623795))

## [5.13.7](https://github.com/SquadRules/mcp/compare/v5.13.6...v5.13.7) (2026-10-27)


### Bug Fixes

* **deps:** resolve npm security advisories ([#208](https://github.com/SquadRules/mcp/issues/208)) ([aa27277](https://github.com/SquadRules/mcp/commit/aa27277a1b601ad77e3ac28e2ff7152fd7edaa9b))

## [5.13.6](https://github.com/SquadRules/mcp/compare/v5.13.5...v5.13.6) (2026-10-27)


### Bug Fixes

* **ci:** route required merge evidence by change class ([#203](https://github.com/SquadRules/mcp/issues/203)) ([7b16309](https://github.com/SquadRules/mcp/commit/7b16309fa2d812191e0caab3abc4018d5686bc32))
* harden embedding dimension resolution and document migration ([#202](https://github.com/SquadRules/mcp/issues/202)) ([c12943a](https://github.com/SquadRules/mcp/commit/c12943a2f62a096d0e4b6408c3ff991e2352b25a))
* **scripts:** correct stale npm-target references and repair deploy-dev-cli-ready.sh ([#189](https://github.com/SquadRules/mcp/issues/189)) ([c1f341f](https://github.com/SquadRules/mcp/commit/c1f341fefbfadb475eeb6f807d0139fcbbcc41c7))

## [5.13.5](https://github.com/SquadRules/mcp/compare/v5.13.4...v5.13.5) (2026-10-25)


### Bug Fixes

* **deps:** pin @anush008/tokenizers to ^0.6.0 for linux/arm64 native bindings ([#178](https://github.com/SquadRules/mcp/issues/178)) ([6e047cf](https://github.com/SquadRules/mcp/commit/6e047cf8836bbfd565226e941c3a6ec1c2316498)), closes [#173](https://github.com/SquadRules/mcp/issues/173)

## [5.13.4](https://github.com/SquadRules/mcp/compare/v5.13.3...v5.13.4) (2026-10-24)


### Bug Fixes

* **ci:** handle redundant dependency PRs and enforce auto-merge gates ([#175](https://github.com/SquadRules/mcp/issues/175)) ([d0f7339](https://github.com/SquadRules/mcp/commit/d0f7339bf41f04cb29458195dd7ddab34ae5b970))
* **deps:** resolve npm security advisories ([#176](https://github.com/SquadRules/mcp/issues/176)) ([e2c9c91](https://github.com/SquadRules/mcp/commit/e2c9c915a5051c83426c79aee7ca3eab049b4b4e))

## [5.13.3](https://github.com/SquadRules/mcp/compare/v5.13.2...v5.13.3) (2026-10-24)


### Bug Fixes

* **ci:** docs wiki detached HEAD + auto-update race condition ([#160](https://github.com/SquadRules/mcp/issues/160)) ([835252d](https://github.com/SquadRules/mcp/commit/835252d5f0c1994923f0abdd1ac5cb4927c97cf2))
* **deps:** resolve npm security advisories ([f07eb0b](https://github.com/SquadRules/mcp/commit/f07eb0bd50f2d71957ab82e00cd3dd9c6369f9b0))
* **deps:** resolve npm security advisories ([0c91b72](https://github.com/SquadRules/mcp/commit/0c91b7222587240d141c70d30bd21b11f60c60d1))
* **deps:** resolve npm security advisories ([cee3125](https://github.com/SquadRules/mcp/commit/cee3125adec7cd70f5cc254ad71e9cdadf05d5f4))
* **deps:** upgrade undici to 8.12.3 ([#174](https://github.com/SquadRules/mcp/issues/174)) ([965259a](https://github.com/SquadRules/mcp/commit/965259a95e58adea6968bff3ffbb8766afaa514e))

## [5.13.2](https://github.com/SquadRules/mcp/compare/v5.13.1...v5.13.2) (2026-10-23)


### Bug Fixes

* **pow:** recursive canonical serializer for proof-of-work evidence hashing ([#163](https://github.com/SquadRules/mcp/issues/163)) ([9af747b](https://github.com/SquadRules/mcp/commit/9af747b98868cc6d42aaa1f39863feea9dfdcb1d))

## [5.13.1](https://github.com/SquadRules/mcp/compare/v5.13.0...v5.13.1) (2026-10-23)


### Bug Fixes

* **ci:** remove unreachable GET /app identity call from verifyIdentity ([d7d7060](https://github.com/SquadRules/mcp/commit/d7d7060510108aad0ef51c7bf72f1965fca40736))
* **ci:** remove unreachable GET /app identity call from verifyIdentity ([5fc2e04](https://github.com/SquadRules/mcp/commit/5fc2e04e5fe8489948888a718b2022c8115f03f5)), closes [#154](https://github.com/SquadRules/mcp/issues/154)
* **embed-docs:** prefix guide example fences to prevent executable parsing ([c3c70ed](https://github.com/SquadRules/mcp/commit/c3c70ed9aa77df748800debbe6e71bbe4333d9eb))
* **embed-docs:** prefix guide example fences to prevent executable parsing ([c8a3445](https://github.com/SquadRules/mcp/commit/c8a344541370d9cb65e32ea81691c282a72e69e0))

## [5.13.0](https://github.com/SquadRules/mcp/compare/v5.12.1...v5.13.0) (2026-10-23)


### Features

* **contracts:** add optional subagent.mcp delegation list ([f66ecba](https://github.com/SquadRules/mcp/commit/f66ecba08e6db1b27db1638297ae2c4e5059ceeb))
* **contracts:** rename mcp contract type to forward and add subagent.mcp ([6507002](https://github.com/SquadRules/mcp/commit/65070029705497c6cc2fe0c6f468ab7dad00486d))


### Bug Fixes

* **contracts:** harden unknown-type guard and subagent.mcp renderer ([37b990d](https://github.com/SquadRules/mcp/commit/37b990d4df50b84211c92a421f6a43a6b5a86869))
* **mem:** align subagent contract field with live schema (instruction -&gt; context) ([b8b17c6](https://github.com/SquadRules/mcp/commit/b8b17c615380e6916c942c63721e5f84281fa098))

## [5.12.1](https://github.com/SquadRules/mcp/compare/v5.12.0...v5.12.1) (2026-10-22)


### Bug Fixes

* **deps:** bump markdown-it ([0b0ce59](https://github.com/SquadRules/mcp/commit/0b0ce5911501758370df437a34f875aa135ed9ab))
* **deps:** bump markdown-it from 14.3.2 to 14.3.3 in the npm-security group across 1 directory ([#151](https://github.com/SquadRules/mcp/issues/151)) ([0b0ce59](https://github.com/SquadRules/mcp/commit/0b0ce5911501758370df437a34f875aa135ed9ab))

## [5.12.0](https://github.com/SquadRules/mcp/compare/v5.11.0...v5.12.0) (2026-10-21)


### Features

* adapter autonomy and verification overhaul ([027ef6e](https://github.com/SquadRules/mcp/commit/027ef6e49af680d7b669ddfea04349ee33eecfbb))
* **validation:** enforce interpreter-required, subagent-allowed, mcp-forward-link-only ([169ab9e](https://github.com/SquadRules/mcp/commit/169ab9e9d6e79cdf8dc15f9e9e1d9c5b489e29e0))


### Bug Fixes

* **ci:** use --update flag for wiki generation to avoid full regeneration ([#134](https://github.com/SquadRules/mcp/issues/134)) ([a3d2f7f](https://github.com/SquadRules/mcp/commit/a3d2f7fceb3434abfddedd944294b2ebe3b9234b))
* **ci:** use GET /app for identity verification with installation tokens ([#137](https://github.com/SquadRules/mcp/issues/137)) ([a6d4505](https://github.com/SquadRules/mcp/commit/a6d45052898cea3d367670a7912710fa37dcc829))
* **integration:** align test fixtures with stricter contract validation ([6f8f56e](https://github.com/SquadRules/mcp/commit/6f8f56ee23765037ab3f78bdc00657b15cfb0488))
* **tests:** remove tensor reference from train-validation message assertion ([e13488a](https://github.com/SquadRules/mcp/commit/e13488a8137a5a8c7bc0f90bc52d1aa30d0d0e6c))

## [5.11.0](https://github.com/SquadRules/mcp/compare/v5.10.1...v5.11.0) (2026-10-16)


### Features

* directory parameter for MCP export/train in SIMPLE mode ([#102](https://github.com/SquadRules/mcp/issues/102)) ([#113](https://github.com/SquadRules/mcp/issues/113)) ([2194f1d](https://github.com/SquadRules/mcp/commit/2194f1dbd50a39afee08ba374b3853a6f3f752eb))


### Bug Fixes

* auto-update open PR branches via gh pr update-branch loop ([#128](https://github.com/SquadRules/mcp/issues/128)) ([f8beadf](https://github.com/SquadRules/mcp/commit/f8beadfba5c215ec3580429c4ffa001788c49f44))
* auto-update open PRs with a gh pr update-branch loop ([f8beadf](https://github.com/SquadRules/mcp/commit/f8beadfba5c215ec3580429c4ffa001788c49f44))
* bind store vector width to provider, fix reads/writes ([#94](https://github.com/SquadRules/mcp/issues/94)) ([#115](https://github.com/SquadRules/mcp/issues/115)) ([8f2e47c](https://github.com/SquadRules/mcp/commit/8f2e47c890fe871847e0e72be05cb38a10ea0d2e))
* **ci:** exclude CI and script paths from release triggers ([#121](https://github.com/SquadRules/mcp/issues/121)) ([9034d4a](https://github.com/SquadRules/mcp/commit/9034d4af83b390f0c2582da85d91db81dbedb989))

## [5.10.1](https://github.com/SquadRules/mcp/compare/v5.10.0...v5.10.1) (2026-10-15)


### Bug Fixes

* clarify adapter boundaries and restrict interpreter enum ([#100](https://github.com/SquadRules/mcp/issues/100), [#103](https://github.com/SquadRules/mcp/issues/103)) ([#110](https://github.com/SquadRules/mcp/issues/110)) ([25e5550](https://github.com/SquadRules/mcp/commit/25e55508e394a1cc017182d2f9557e2839cdd782))

## [5.10.0](https://github.com/SquadRules/mcp/compare/v5.9.8...v5.10.0) (2026-10-15)


### Features

* add subagent contract type with anti-cheat evidence gate ([#99](https://github.com/SquadRules/mcp/issues/99), [#97](https://github.com/SquadRules/mcp/issues/97)) ([#114](https://github.com/SquadRules/mcp/issues/114)) ([8ebc7fc](https://github.com/SquadRules/mcp/commit/8ebc7fc6adb2f06bd16a1d2ef76d348886653e01))


### Bug Fixes

* resolve 5 agent retry friction points ([#105](https://github.com/SquadRules/mcp/issues/105)) ([#112](https://github.com/SquadRules/mcp/issues/112)) ([7e5a886](https://github.com/SquadRules/mcp/commit/7e5a8866d9d65fc22512ff8376691822c3014892))

## [5.9.8](https://github.com/SquadRules/mcp/compare/v5.9.7...v5.9.8) (2026-10-15)


### Bug Fixes

* replace deprecated prom-client with @prometheus-io/client ([#77](https://github.com/SquadRules/mcp/issues/77)) ([#111](https://github.com/SquadRules/mcp/issues/111)) ([dba7fe4](https://github.com/SquadRules/mcp/commit/dba7fe4edb463fd6b6a8dfbe4f1acf0dbd1beaaa))

## [5.9.7](https://github.com/SquadRules/mcp/compare/v5.9.6...v5.9.7) (2026-10-15)


### Bug Fixes

* **ci:** add path filtering to release workflow ([#119](https://github.com/SquadRules/mcp/issues/119)) ([a2f08f1](https://github.com/SquadRules/mcp/commit/a2f08f122fc9be9ca7014114379d90a913299e6f))
* filter redirect tombstones from activate results and demote boot logs to debug ([#70](https://github.com/SquadRules/mcp/issues/70)) ([#109](https://github.com/SquadRules/mcp/issues/109)) ([5c8ed6e](https://github.com/SquadRules/mcp/commit/5c8ed6eea057cbe7d302aa6156df5c511e2b87da))

## [5.9.6](https://github.com/SquadRules/mcp/compare/v5.9.5...v5.9.6) (2026-10-15)


### Bug Fixes

* **ci:** use native path filtering to prevent empty-diff bypass ([#116](https://github.com/SquadRules/mcp/issues/116)) ([456cce8](https://github.com/SquadRules/mcp/commit/456cce891107b8a1e271f2c5eb9a4413db9b757c))

## [5.9.5](https://github.com/SquadRules/mcp/compare/v5.9.4...v5.9.5) (2026-10-15)


### Bug Fixes

* skip application-level cache for embedded LanceDB ([#96](https://github.com/SquadRules/mcp/issues/96)) ([aaadb34](https://github.com/SquadRules/mcp/commit/aaadb34196643ec5dede7071382f76e71c61a1eb)), closes [#95](https://github.com/SquadRules/mcp/issues/95)

## [5.9.4](https://github.com/SquadRules/mcp/compare/v5.9.3...v5.9.4) (2026-10-15)


### Bug Fixes

* embedding provider resolution and store width binding ([#98](https://github.com/SquadRules/mcp/issues/98)) ([3c7b0d8](https://github.com/SquadRules/mcp/commit/3c7b0d8ea68a7b59a1fe5600889a01949927249a))

## [5.9.3](https://github.com/SquadRules/mcp/compare/v5.9.2...v5.9.3) (2026-10-15)


### Bug Fixes

* **security:** exclude js/user-controlled-bypass CodeQL false positives ([#90](https://github.com/SquadRules/mcp/issues/90)) ([caff1e9](https://github.com/SquadRules/mcp/commit/caff1e91b2d62ee6461babc72f139d359e548d0f))

## [5.9.2](https://github.com/SquadRules/mcp/compare/v5.9.1...v5.9.2) (2026-10-14)


### Bug Fixes

* **ci:** use correct @qoder-ai/qodercli package for wiki generation ([#86](https://github.com/SquadRules/mcp/issues/86)) ([99a2db5](https://github.com/SquadRules/mcp/commit/99a2db5168f74a045786764f4b1a4ccd438c2fcf))
* **ci:** use correct wiki command syntax ([#88](https://github.com/SquadRules/mcp/issues/88)) ([6ca2d72](https://github.com/SquadRules/mcp/commit/6ca2d72849c1e7d8e58ce06dfd9402230601f486))

## [5.9.1](https://github.com/SquadRules/mcp/compare/v5.9.0...v5.9.1) (2026-10-14)


### Bug Fixes

* pin layer manifest and return copy-paste-ready next-call objects ([#79](https://github.com/SquadRules/mcp/issues/79)) ([#81](https://github.com/SquadRules/mcp/issues/81)) ([b8065aa](https://github.com/SquadRules/mcp/commit/b8065aaff6621700b5924b0666b2398a6892903e))
* use git ls-remote for wiki repo check ([#84](https://github.com/SquadRules/mcp/issues/84)) ([6920cdf](https://github.com/SquadRules/mcp/commit/6920cdf8aa4cd14806b35ec8d74c6f835fe6f3ba))
* use git ls-remote for wiki repo check (gh repo view does not resolve wiki repos) ([6920cdf](https://github.com/SquadRules/mcp/commit/6920cdf8aa4cd14806b35ec8d74c6f835fe6f3ba))

## [5.9.0](https://github.com/SquadRules/mcp/compare/v5.8.1...v5.9.0) (2026-10-14)


### Features

* add docs wiki bot and tier docs-only PRs ([#78](https://github.com/SquadRules/mcp/issues/78)) ([f7b7f0b](https://github.com/SquadRules/mcp/commit/f7b7f0b5bb086212e23c381ba14b92be1b737a3c))

## [5.8.1](https://github.com/SquadRules/mcp/compare/v5.8.0...v5.8.1) (2026-10-14)


### Bug Fixes

* prevent PROOF_HASH_MISMATCH when requested layer has no stored nonce ([#75](https://github.com/SquadRules/mcp/issues/75)) ([f3c92fc](https://github.com/SquadRules/mcp/commit/f3c92fcf5051c793c08aa85933470d9ec6b01912))
* prevent PROOF_HASH_MISMATCH when requested layer has no stored nonce ([#76](https://github.com/SquadRules/mcp/issues/76)) ([f3c92fc](https://github.com/SquadRules/mcp/commit/f3c92fcf5051c793c08aa85933470d9ec6b01912))

## [5.8.0](https://github.com/SquadRules/mcp/compare/v5.7.0...v5.8.0) (2026-10-14)


### Features

* **ci:** add every-6-hour auto-merge workflow for dependency PRs ([#68](https://github.com/SquadRules/mcp/issues/68)) ([74a4b05](https://github.com/SquadRules/mcp/commit/74a4b05b803ccdaab1f1b7b5240c8b4583ad3c85))

## [5.7.0](https://github.com/SquadRules/mcp/compare/v5.6.1...v5.7.0) (2026-10-13)


### Features

* **mem:** make critic-loop accept a typed work submission ([#66](https://github.com/SquadRules/mcp/issues/66)) ([7fc56e4](https://github.com/SquadRules/mcp/commit/7fc56e471e170f36df209a146009d01f055768bc))

## [5.6.1](https://github.com/SquadRules/mcp/compare/v5.6.0...v5.6.1) (2026-10-13)


### Bug Fixes

* rename create-new-protocol to author-adapter with redirect tombstone ([#63](https://github.com/SquadRules/mcp/issues/63)) ([c89282f](https://github.com/SquadRules/mcp/commit/c89282f5ee380ac222920c1d793e88cae143af28))

## [5.6.0](https://github.com/SquadRules/mcp/compare/v5.5.1...v5.6.0) (2026-10-13)


### Features

* **cli:** rich default output with colors and ASCII tables ([#61](https://github.com/SquadRules/mcp/issues/61)) ([9d9dc62](https://github.com/SquadRules/mcp/commit/9d9dc62fe87918f0e8c21dbd2247f7e97438c09d))

## [5.5.1](https://github.com/SquadRules/mcp/compare/v5.5.0...v5.5.1) (2026-10-13)


### Bug Fixes

* **cli:** route local-mode boot logs to stderr so stdout stays parseable ([#59](https://github.com/SquadRules/mcp/issues/59)) ([a62c965](https://github.com/SquadRules/mcp/commit/a62c965a2389a13588a74bc1d22ec2dea6a49e97))

## [5.5.0](https://github.com/SquadRules/mcp/compare/v5.4.2...v5.5.0) (2026-10-12)


### Features

* **cli:** local-by-default transport-agnostic backend ([d367548](https://github.com/SquadRules/mcp/commit/d367548ba8d9aefe1ef7c6032b08debdc58f7e41))
* **cli:** local-by-default, transport-agnostic backend with human-first output ([#57](https://github.com/SquadRules/mcp/issues/57)) ([d367548](https://github.com/SquadRules/mcp/commit/d367548ba8d9aefe1ef7c6032b08debdc58f7e41))

## [5.4.2](https://github.com/SquadRules/mcp/compare/v5.4.1...v5.4.2) (2026-10-12)


### Bug Fixes

* **mem:** keep redirect tombstones for retired phase-critic slugs ([#55](https://github.com/SquadRules/mcp/issues/55)) ([e461d90](https://github.com/SquadRules/mcp/commit/e461d90ae3a3a3828c683074ae63ce446002bae2))

## [5.4.1](https://github.com/SquadRules/mcp/compare/v5.4.0...v5.4.1) (2026-10-12)


### Bug Fixes

* **release:** automate release PR checks and protected merge ([#53](https://github.com/SquadRules/mcp/issues/53)) ([1a55920](https://github.com/SquadRules/mcp/commit/1a55920996401095846a8f903348ddf476ea84a6))
* **release:** use App identity and protected auto-merge for unattended releases ([1a55920](https://github.com/SquadRules/mcp/commit/1a55920996401095846a8f903348ddf476ea84a6))

## [5.4.0](https://github.com/SquadRules/mcp/compare/v5.3.1...v5.4.0) (2026-10-12)


### Features

* **mem:** make bundled adapters fully autonomous (drop human gates) ([#48](https://github.com/SquadRules/mcp/issues/48)) ([77d46d0](https://github.com/SquadRules/mcp/commit/77d46d0001c20b0f5ad936ec1eab2d9f59d42231))

## [5.3.1](https://github.com/SquadRules/mcp/compare/v5.3.0...v5.3.1) (2026-10-12)


### Bug Fixes

* **mem:** fire boot-injection reuse skip by reading nested adapter version ([#45](https://github.com/SquadRules/mcp/issues/45)) ([ed97b46](https://github.com/SquadRules/mcp/commit/ed97b467ad1e2144fadcd49e862b9c663eb17256))

## [5.3.0](https://github.com/SquadRules/mcp/compare/v5.2.0...v5.3.0) (2026-10-11)


### Features

* **ci:** add fastembed model cache and stdio integration test to SINGLE lane ([#37](https://github.com/SquadRules/mcp/issues/37)) ([c4f81c4](https://github.com/SquadRules/mcp/commit/c4f81c42bc70106694b0e08c55f8d118b2f5b2d4))
* **cli:** bare invocation defaults to stdio server; capability-oriented boot logs ([#39](https://github.com/SquadRules/mcp/issues/39)) ([671f3ba](https://github.com/SquadRules/mcp/commit/671f3ba45c3eeb893eaeac2f4002cd80fc9b53b9))


### Bug Fixes

* **ci:** target repository when dispatching release checks ([#43](https://github.com/SquadRules/mcp/issues/43)) ([3ac0127](https://github.com/SquadRules/mcp/commit/3ac01271d19a4780ef586c51a05356ab399915c7))

## [5.2.0](https://github.com/SquadRules/mcp/compare/v5.1.0...v5.2.0) (2026-10-08)


### Features

* **config:** default FASTEMBED_MODEL to fast-bge-small-en-v1.5 ([eb1472d](https://github.com/SquadRules/mcp/commit/eb1472d5c6bebb9b5949187f4ebbd172ececcb46))
* **config:** default FASTEMBED_MODEL to fast-bge-small-en-v1.5 (384-d) ([#33](https://github.com/SquadRules/mcp/issues/33)) ([eb1472d](https://github.com/SquadRules/mcp/commit/eb1472d5c6bebb9b5949187f4ebbd172ececcb46))


### Bug Fixes

* **deps:** patch npm audit advisories via overrides; prod scope clean ([#31](https://github.com/SquadRules/mcp/issues/31)) ([c988ecc](https://github.com/SquadRules/mcp/commit/c988ecc2012b15c771c68c04a834cc70b282a00c))
* **release:** persist published version in source ([#27](https://github.com/SquadRules/mcp/issues/27)) ([0c07358](https://github.com/SquadRules/mcp/commit/0c07358ee9b69f84d7f716b6d1ce448b87254392))
* **release:** preserve leading status columns when parsing source changes ([15eda60](https://github.com/SquadRules/mcp/commit/15eda6015e76d8d9159527456f3ab781af2b58cf))
* **release:** preserve source paths when parsing git status ([#29](https://github.com/SquadRules/mcp/issues/29)) ([15eda60](https://github.com/SquadRules/mcp/commit/15eda6015e76d8d9159527456f3ab781af2b58cf))
* **release:** remove PAT dependency from Release Please ([#35](https://github.com/SquadRules/mcp/issues/35)) ([08ed9e1](https://github.com/SquadRules/mcp/commit/08ed9e1a70a390c3c6481aca991ec9c4d0a94538))
