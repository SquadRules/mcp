# Source evidence for revised assessment

Inspected 7 October 2026. Source archives were downloaded without executing lifecycle scripts. Source matches the exact inspected package versions; findings about usage are bounded to these call sites.

## pr31-reassessment/npm-11.21.0/package/node_modules/make-fetch-happen/lib/cache/policy.js

SHA-256: `2014cf549fceb8808cba81e8760315b9060f502b6c62b7cb79e1b024abde54c3`

```text
1: const CacheSemantics = require('http-cache-semantics')
2: const Negotiator = require('negotiator')
3: const ssri = require('ssri')
4:
5: // options passed to http-cache-semantics constructor
6: const policyOptions = {
7:   shared: false,
8:   ignoreCargoCult: true,
9: }
10:
11: // a fake empty response, used when only testing the
12: // request for storability
13: const emptyResponse = { status: 200, headers: {} }
14:
15: // returns a plain object representation of the Request
16: const requestObject = (request) => {
17:   const _obj = {
18:     method: request.method,
19:     url: request.url,
20:     headers: {},
21:     compress: request.compress,
22:   }
23:
24:   request.headers.forEach((value, key) => {
25:     _obj.headers[key] = value
26:   })
27:
28:   return _obj
29: }
30:
31: // returns a plain object representation of the Response
32: const responseObject = (response) => {
33:   const _obj = {
34:     status: response.status,
35:     headers: {},
36:   }
37:
38:   response.headers.forEach((value, key) => {
39:     _obj.headers[key] = value
40:   })
41:
42:   return _obj
43: }
44:
45: class CachePolicy {
46:   constructor ({ entry, request, response, options }) {
47:     this.entry = entry
48:     this.request = requestObject(request)
49:     this.response = responseObject(response)
50:     this.options = options
51:     this.policy = new CacheSemantics(this.request, this.response, policyOptions)
52:
53:     if (this.entry) {
54:       // if we have an entry, copy the timestamp to the _responseTime
55:       // this is necessary because the CacheSemantics constructor forces
```

## pr31-reassessment/npm-11.21.0/package/node_modules/node-gyp/lib/download.js

SHA-256: `e136afe6ae2828114abf0ddae296d1fdd0c8e418922f7f6f6363bc51761db5fe`

```text
1: const { Readable } = require('stream')
2: const { Agent, EnvHttpProxyAgent, RetryAgent, fetch } = require('undici')
3: const { promises: fs } = require('graceful-fs')
4: const log = require('./log')
5:
6: async function download (gyp, url) {
7:   log.http('GET', url)
8:
9:   const requestOpts = {
10:     headers: {
11:       'User-Agent': `node-gyp v${gyp.version} (node ${process.version})`,
12:       Connection: 'keep-alive'
13:     },
14:     dispatcher: await createDispatcher(gyp)
15:   }
16:
17:   let res
18:   try {
19:     res = await fetch(url, requestOpts)
20:   } catch (err) {
21:     // Built-in fetch wraps low-level errors in "TypeError: fetch failed" with
22:     // the underlying error on .cause. Callers inspect .code (e.g. ENOTFOUND).
23:     if (err.cause) {
24:       throw err.cause
25:     }
26:     throw err
27:   }
28:
29:   log.http(res.status, res.url)
30:
31:   const body = res.body ? Readable.fromWeb(res.body) : Readable.from([])
32:   return {
33:     status: res.status,
34:     url: res.url,
35:     body,
36:     text: async () => {
37:       let data = ''
38:       body.setEncoding('utf8')
39:       for await (const chunk of body) {
40:         data += chunk
41:       }
42:       return data
```

## pr31-reassessment/npm-11.21.0/package/node_modules/socks/build/common/helpers.js

SHA-256: `dcbb2f1bcb2e7450ae05a2cc911c925151ee0a03baa501823b4e8e82ada48393`

```text
144:     return [octet1, octet2, octet3, octet4].join('.');
145: }
146: exports.int32ToIpv4 = int32ToIpv4;
147: function ipToBuffer(ip) {
148:     if (net.isIPv4(ip)) {
149:         // Handle IPv4 addresses
150:         const address = new ip_address_1.Address4(ip);
151:         return Buffer.from(address.toArray());
152:     }
153:     else if (net.isIPv6(ip)) {
154:         // Handle IPv6 addresses
155:         const address = new ip_address_1.Address6(ip);
156:         return Buffer.from(address
157:             .canonicalForm()
158:             .split(':')
159:             .map((segment) => segment.padStart(4, '0'))
160:             .join(''), 'hex');
161:     }
```

## pr31-reassessment/npm-11.21.0/package/lib/commands/sbom.js

SHA-256: `88ee9041c48f325a33832e06da70d5d06b015465287db3f088fa4792f0ac0eb0`

```text
76:   #buildSelector ({ wsNodes }) {
77:     let selector
78:     const omit = this.npm.flatOptions.omit
79:     const workspacesEnabled = this.npm.flatOptions.workspacesEnabled
80:
81:     // If omit is specified, omit all nodes and their children which match the specified selectors
82:     const omits = omit.reduce((acc, o) => `${acc}:not(.${o})`, '')
83:
84:     if (!workspacesEnabled) {
85:       // If workspaces are disabled, omit all workspace nodes and their children
86:       selector = `:root > :not(.workspace)${omits},:root > :not(.workspace) *${omits},:extraneous`
87:     } else if (wsNodes && wsNodes.length > 0) {
88:       // If one or more workspaces are selected, select only those workspaces and their children
89:       selector = wsNodes.map(ws => `#${ws.name},#${ws.name} *${omits}`).join(',')
90:     } else {
91:       selector = `:root *${omits},:extraneous`
92:     }
93:
94:     // Always include the root node
95:     return `:root,${selector}`
96:   }
97:
98:   // builds a normalized inventory
99:   #buildResponse (items) {
100:     const sbomFormat = this.npm.config.get('sbom-format')
101:     const packageType = this.npm.config.get('sbom-type')
102:     const packageLockOnly = this.npm.config.get('package-lock-only')
103:
104:     this.#response = sbomFormat === 'cyclonedx'
105:       ? cyclonedxOutput({ npm: this.npm, nodes: items, packageType, packageLockOnly })
```

## pr31-reassessment/semantic-release-commit-analyzer-13.0.1/package/lib/analyze-commit.js

SHA-256: `e40acc103dc0431b003fdbc78d9a9f76cf2e31b87fcacbb8ea4ee3fdeac794f6`

```text
15: export default (releaseRules, commit) => {
16:   let releaseType;
17:
18:   releaseRules
19:     .filter(
20:       ({ breaking, revert, release, ...rule }) =>
21:         // If the rule is not `breaking` or the commit doesn't have a breaking change note
22:         (!breaking || (commit.notes && commit.notes.length > 0)) &&
23:         // If the rule is not `revert` or the commit is not a revert
24:         (!revert || commit.revert) &&
25:         // Otherwise match the regular rules
26:         isMatchWith(commit, rule, (object, src) =>
27:           isString(src) && isString(object) ? micromatch.isMatch(object, src) : undefined
28:         )
29:     )
30:     .every((match) => {
31:       if (compareReleaseTypes(releaseType, match.release)) {
```

## pr31-reassessment/semantic-release-25.0.9/package/lib/branches/expand.js

SHA-256: `084676e2df02b4a73024438f95294bbd57bafc36e4dc3a8ad3f9820cb6393d51`

```text
1: import { isString, mapValues, omit, remove, template } from "lodash-es";
2: import micromatch from "micromatch";
3: import { getBranches } from "../git.js";
4:
5: export default async (repositoryUrl, { cwd }, branches) => {
6:   const gitBranches = await getBranches(repositoryUrl, { cwd });
7:
8:   return branches.reduce(
9:     (branches, branch) => [
10:       ...branches,
11:       ...remove(gitBranches, (name) => micromatch(gitBranches, branch.name).includes(name)).map((name) => ({
12:         name,
13:         ...mapValues(omit(branch, "name"), (value) =>
14:           isString(value) ? template(value, { evaluate: false, escape: false })({ name }) : value
15:         ),
16:       })),
17:     ],
18:     []
19:   );
20: };
21:
```

## pr31-tools-smoke/node_modules/markdownlint-cli2/markdownlint-cli2.mjs

SHA-256: `19b15e37e4d103632fee5665dc4a3d9b9c0d2983d36d4bf9cce9ab2f908d5838`

```text
210: // Filter a list of files by glob(s)
211: const filterByGlobs = (/** @type {string} */ dir, /** @type {string[]} */ files, /** @type {string[]} */ globs) => (
212:   micromatch(
213:     files.map((file) => pathPosix.relative(dir, file)),
214:     globs,
215:     { "dot": true }
216:   ).map((file) => pathPosix.join(dir, file))
217: );
218:
```

## security-research-pr31/package.json

SHA-256: `b7eb08ad941a31e07a8d4c92b4350750adeabbb8e573f36dbf6c5a9a394f9031`

```text
108:     "handoff": "npm run dev:deploy && npm run dev:test && npm run ensure-coding-rules && npm run knip && npm run lint:markdown && npm run lint:mermaid",
109:     "infra:up": "docker compose -p squadrules-mcp --env-file .env -f compose/infra.yaml --profile fullstack up -d --remove-orphans && python3 scripts/deploy-configure-keycloak-realms.py",
110:     "lint": "eslint . && npm run lint:skills && npm run lint:markdown && npm run lint:docs",
111:     "lint:fix": "eslint . --ext .ts,.tsx,.js,.jsx,.mjs,.cjs --fix && npm run lint:markdown:fix",
112:     "lint:skills": "python3 scripts/lint-agent-skills.py",
113:     "lint:docs": "node scripts/lint-docs-links.mjs",
114:     "lint:markdown": "markdownlint-cli2 'docs/**/*.md' 'README.md' 'CONTRIBUTING.md' 'SECURITY.md' --config .markdownlint.jsonc --no-progress",
115:     "lint:markdown:fix": "markdownlint-cli2 'docs/**/*.md' 'README.md' 'CONTRIBUTING.md' 'SECURITY.md' --config .markdownlint.jsonc --no-progress --fix",
116:     "lint:mermaid": "./scripts/validate-mermaid.sh docs/**/*.md",
117:     "version:sync": "npm run version:sync-skills",
```

## security-research-pr31/.github/workflows/integration.yml

SHA-256: `2c359733e4ddb2e384698a60d347b7c49680874cc440412a9e64dd5be9adb9fb`

```text
15:
16: jobs:
17:   build:
18:     name: Build and checks (Node ${{ matrix.node }})
19:     runs-on: ubuntu-latest
20:     timeout-minutes: 20
21:     strategy:
22:       fail-fast: false
23:       matrix:
24:         node: ['24', '26']
25:     steps:
26:       - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
27:         with:
28:           ref: ${{ github.sha }}
29:           persist-credentials: false
30:           fetch-depth: 0
31:       - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
32:         with:
33:           node-version: ${{ matrix.node }}
34:           cache: npm
35:       - run: npm ci
36:       - run: npm run version:check-skills
37:       - run: npm run lint
38:       - run: npm run typecheck
39:       - run: npm run knip
40:       - run: npm run test:spec-parity
41:       - run: npm run test:ui
42:       - run: npm run build:tgz
43:       - run: npm run test:tgz
```

## security-research-pr31/.puppeteer-config.json

SHA-256: `478cc926c5bcf1a8750c7c365489dce18703f56f8c255f3106083a2bfc56858f`

```text
1: {
2:   "args": ["--no-sandbox", "--disable-setuid-sandbox"]
3: }
```
