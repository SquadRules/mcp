# Changelog

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
