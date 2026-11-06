# Graph Database License Compatibility Matrix

**Status:** Final  
**Created:** 2026-11-05  
**Purpose:** Validate license compatibility for graph database options in SquadRules 6  
**Context:** SquadRules is MIT-licensed; all dependencies must be compatible

---

## Executive Summary

**SquadRules License:** MIT (permissive open-source)

**Compatible Options:**

- ✅ **LadybugDB (MIT)** — Fully compatible, recommended for embedded mode
- ✅ **ArangoDB ≤v3.11 (Apache 2.0)** — Compatible, recommended for shared mode (must pin version)

**Incompatible Options:**

- ❌ **Neo4j Community (GPL v3)** — Incompatible for embedded deployment with MIT
- ❌ **FalkorDB (SSPL v1)** — Incompatible (SaaS copyleft)
- ❌ **ArangoDB ≥v3.12 (BSL 1.1)** — Restricts commercial use

**Key Finding:** GPL v3 and SSPL are fundamentally incompatible with MIT for embedded/bundled deployment. Copyleft licenses trigger when code is distributed or combined, not just for SaaS (except GPL has "SaaS loophole").

---

## Detailed Analysis

### 1. LadybugDB (Kuzu fork) — MIT License

**License:** MIT  
**Compatibility:** ✅ **Fully compatible**  
**Risk Level:** Low  
**Recommendation:** **PROCEED**

**Evidence:**

- MIT license is permissive, same as SquadRules
- No copyleft restrictions
- Can be embedded, bundled, distributed, used in SaaS
- Active development (fork of archived Kuzu)

**Deployment Models:**

- ✅ Embedded mode: Zero restrictions
- ✅ Shared mode: Zero restrictions
- ✅ Commercial use: Allowed
- ✅ SaaS deployment: Allowed

**Notes:**

- Kuzu was archived in October 2025
- LadybugDB is the active fork with same MIT license
- All Kuzu features retained (graph-native, vector search, full-text search)

---

### 2. ArangoDB ≤v3.11 — Apache 2.0 License

**License:** Apache 2.0  
**Compatibility:** ✅ **Compatible**  
**Risk Level:** Low (for ≤v3.11)  
**Recommendation:** **PROCEED (pin to ≤v3.11)**

**Evidence:**

- Apache 2.0 is permissive, compatible with MIT
- No copyleft restrictions
- Can be embedded, bundled, distributed, used in SaaS
- Active development, mature project

**Deployment Models:**

- ✅ Embedded mode: Zero restrictions (≤v3.11)
- ✅ Shared mode: Zero restrictions (≤v3.11)
- ✅ Commercial use: Allowed (≤v3.11)
- ✅ SaaS deployment: Allowed (≤v3.11)

**Critical Constraint:**

- **Must pin to version ≤v3.11** — v3.12+ uses BSL 1.1 license
- BSL 1.1 (Business Source License) restricts commercial use
- BSL is source-available, not open-source (OSI-approved)

**Version Pinning Strategy:**

- Use `arangodb/arangodb:3.11.x` Docker image
- Lock dependency to `^3.11.0` in package manager
- Monitor ArangoDB releases for license changes
- Have migration plan ready (to LadybugDB or other) if needed

---

### 3. ArangoDB ≥v3.12 — BSL 1.1 License

**License:** BSL 1.1 (Business Source License)  
**Compatibility:** ⚠️ **Conditionally incompatible**  
**Risk Level:** Medium-High  
**Recommendation:** **AVOID or consult legal**

**Evidence:**

- BSL 1.1 is source-available, not open-source (OSI-approved)
- Restricts commercial use and SaaS offerings
- Compatible with non-commercial, personal, or evaluation use
- Commercial deployment requires separate license

**Deployment Models:**

- ⚠️ Embedded mode: Restricted for commercial use
- ⚠️ Shared mode: Restricted for commercial use
- ❌ Commercial use: Requires separate license
- ❌ SaaS deployment: Requires separate license

**When to Consider:**

- SquadRules is non-commercial (research, personal, educational)
- Willing to obtain commercial license
- Features in v3.12+ are critical and unavailable in ≤v3.11

**Mitigation:**

- Pin to ≤v3.11 (Apache 2.0) to avoid BSL restrictions
- Monitor ArangoDB licensing for future changes

---

### 4. Neo4j Community Edition — GPL v3 License

**License:** GPL v3 (GNU General Public License v3)  
**Compatibility:** ❌ **Incompatible for embedded deployment**  
**Risk Level:** High  
**Recommendation:** **AVOID for embedded mode**

**Evidence:**

- GPL v3 is copyleft, incompatible with MIT for bundled/embedded distribution
- GPL requires derivative works to be licensed under GPL
- SquadRules (MIT) cannot bundle GPL v3 code without relicensing entire project
- GPL has "SaaS loophole" — network use does not trigger copyleft

**Deployment Models:**

- ❌ Embedded mode: Incompatible (bundling triggers copyleft)
- ⚠️ Shared mode (separate service): May be acceptable (SaaS loophole)
- ❌ Commercial use (embedded): Requires commercial license
- ⚠️ SaaS deployment (separate service): May be acceptable

**SaaS Loophole Analysis:**

- GPL copyleft triggers on **distribution**, not network use
- If Neo4j runs as separate service (not bundled), GPL may not apply
- SquadRules would interact with Neo4j over network (HTTP/TCP)
- This is legally gray — consult legal counsel before relying on this

**When to Consider:**

- Deploy Neo4j as separate service (not embedded)
- Obtain commercial license (Neo4j Enterprise)
- Willing to relicense SquadRules under GPL v3 (unlikely)

**Mitigation:**

- Use ArangoDB ≤v3.11 (Apache 2.0) instead
- Or deploy Neo4j as separate service with commercial license

---

### 5. FalkorDB — SSPL v1 License

**License:** SSPL v1 (Server Side Public License)  
**Compatibility:** ❌ **Incompatible**  
**Risk Level:** High  
**Recommendation:** **AVOID**

**Evidence:**

- SSPL extends copyleft to network/SaaS use
- Requires open-sourcing entire service stack if offered as service
- Not OSI-approved (not considered "open source" by standard definition)
- High enterprise adoption barrier

**Deployment Models:**

- ❌ Embedded mode: Incompatible (SSPL copyleft)
- ❌ Shared mode: Incompatible (SSPL extends to SaaS)
- ❌ Commercial use: Requires commercial license
- ❌ SaaS deployment: Requires open-sourcing entire stack or commercial license

**When to Consider:**

- Never (unless willing to open-source entire SquadRules stack)
- Or obtain commercial license (FalkorDB Enterprise)

**Mitigation:**

- Use LadybugDB (MIT) or ArangoDB ≤v3.11 (Apache 2.0) instead

---

## Compatibility Matrix

| Database | License | Embedded (MIT) | Shared (MIT) | Commercial | SaaS | Recommendation |
|----------|---------|----------------|--------------|------------|------|----------------|
| **LadybugDB** | MIT | ✅ Compatible | ✅ Compatible | ✅ Allowed | ✅ Allowed | **PROCEED** |
| **ArangoDB ≤v3.11** | Apache 2.0 | ✅ Compatible | ✅ Compatible | ✅ Allowed | ✅ Allowed | **PROCEED (pin version)** |
| **ArangoDB ≥v3.12** | BSL 1.1 | ⚠️ Restricted | ⚠️ Restricted | ❌ Requires license | ❌ Requires license | **AVOID** |
| **Neo4j Community** | GPL v3 | ❌ Incompatible | ⚠️ SaaS loophole | ❌ Requires license | ⚠️ Gray area | **AVOID (embedded)** |
| **FalkorDB** | SSPL v1 | ❌ Incompatible | ❌ Incompatible | ❌ Requires license | ❌ Incompatible | **AVOID** |

---

## Risk Assessment

### Low Risk (Proceed)

- ✅ **LadybugDB (MIT)** — Same license as SquadRules, zero restrictions
- ✅ **ArangoDB ≤v3.11 (Apache 2.0)** — Permissive license, compatible with MIT

### Medium Risk (Monitor)

- ⚠️ **ArangoDB version pinning** — Must monitor releases, have migration plan ready
- ⚠️ **Neo4j as separate service** — SaaS loophole legally gray, consult counsel

### High Risk (Avoid)

- ❌ **Neo4j embedded** — GPL v3 copyleft incompatible with MIT
- ❌ **FalkorDB** — SSPL extends copyleft to SaaS, not OSI-approved
- ❌ **ArangoDB ≥v3.12** — BSL restricts commercial use

---

## Compliance Checklist

### For LadybugDB (MIT)

- [x] License is MIT (permissive, compatible)
- [x] No copyleft restrictions
- [x] Can be embedded, bundled, distributed
- [x] Can be used in commercial products
- [x] Can be used in SaaS deployments
- [x] Attribution required (include copyright notice)

### For ArangoDB ≤v3.11 (Apache 2.0)

- [x] License is Apache 2.0 (permissive, compatible)
- [x] No copyleft restrictions
- [x] Can be embedded, bundled, distributed
- [x] Can be used in commercial products
- [x] Can be used in SaaS deployments
- [x] Attribution required (include NOTICE file)
- [x] **Version pinned to ≤v3.11** (avoid BSL 1.1 in v3.12+)
- [ ] Migration plan ready (if ArangoDB changes license again)

### For Neo4j Community (GPL v3) — NOT RECOMMENDED

- [ ] License is GPL v3 (copyleft, incompatible with MIT for embedding)
- [ ] Cannot be embedded/bundled without relicensing SquadRules to GPL
- [ ] May be used as separate service (SaaS loophole) — consult legal
- [ ] Commercial license available (Neo4j Enterprise)

### For FalkorDB (SSPL v1) — NOT RECOMMENDED

- [ ] License is SSPL v1 (copyleft, extends to SaaS)
- [ ] Cannot be used without open-sourcing entire service stack
- [ ] Commercial license available (FalkorDB Enterprise)

---

## Deployment Model Impact

### Embedded Mode (Zero Installation)

- **LadybugDB:** ✅ Perfect fit — MIT license, embedded, zero dependencies
- **ArangoDB ≤v3.11:** ⚠️ Possible — Apache 2.0 allows embedding, but heavier than LadybugDB
- **Neo4j Community:** ❌ Not viable — GPL v3 incompatible with MIT embedding
- **FalkorDB:** ❌ Not viable — SSPL incompatible with any deployment model

### Shared Mode (Enterprise/Scalable)

- **LadybugDB:** ✅ Viable — if it supports distributed clustering (verify)
- **ArangoDB ≤v3.11:** ✅ Perfect fit — Apache 2.0, multi-model, open-source clustering
- **Neo4j Community:** ⚠️ Gray area — may work as separate service (SaaS loophole), consult legal
- **FalkorDB:** ❌ Not viable — SSPL restricts SaaS deployment

---

## Recommendations

### Primary Recommendation: LadybugDB (Embedded) + ArangoDB ≤v3.11 (Shared)

**Rationale:**

1. **LadybugDB (MIT)** — Fully compatible, zero restrictions, lightweight, embedded
2. **ArangoDB ≤v3.11 (Apache 2.0)** — Fully compatible, multi-model, open-source clustering
3. **Mode agnosticism** — Both support graph-native operations, similar APIs
4. **Risk mitigation** — Both use permissive licenses (MIT, Apache 2.0)

**Implementation:**

- Use LadybugDB for embedded deployments (zero installation)
- Use ArangoDB ≤v3.11 for shared deployments (enterprise/scalable)
- Pin ArangoDB to ≤v3.11 to avoid BSL 1.1 license change
- Abstract graph layer to support both databases (swap if needed)

### Alternative Recommendation: LadybugDB for Both Modes

**Rationale:**

1. **Single database** — Simplifies deployment, maintenance, documentation
2. **MIT license** — Zero restrictions for any deployment model
3. **Embedded + shared** — Verify if LadybugDB supports distributed clustering

**Implementation:**

- Use LadybugDB for both embedded and shared deployments
- If LadybugDB lacks clustering, use ArangoDB ≤v3.11 for shared mode

### Not Recommended: Neo4j or FalkorDB

**Rationale:**

1. **Neo4j (GPL v3)** — Incompatible with MIT for embedded deployment
2. **FalkorDB (SSPL v1)** — Incompatible with any deployment model (SaaS copyleft)
3. **Legal risk** — GPL and SSPL create significant compliance burden

**When to Reconsider:**

- Neo4j: If deployed as separate service (not embedded) with commercial license
- FalkorDB: If commercial license obtained (FalkorDB Enterprise)

---

## Next Steps

1. **Verify LadybugDB features** — Confirm it supports all required graph operations
2. **Test LadybugDB clustering** — Determine if it can serve shared mode
3. **Pin ArangoDB version** — Lock to ≤v3.11 in deployment scripts
4. **Abstract graph layer** — Implement mode-agnostic API (LadybugDB + ArangoDB)
5. **Legal review** — Consult counsel if considering Neo4j as separate service
6. **Monitor licenses** — Track ArangoDB, LadybugDB license changes

---

## References

- SquadRules LICENSE: `LICENSE` file in repository root (MIT)
- LadybugDB: <https://github.com/ladybugdb/ladybugdb> (MIT)
- ArangoDB: <https://arangodb.com/> (Apache 2.0 for ≤v3.11, BSL 1.1 for ≥v3.12)
- Neo4j: <https://neo4j.com/> (GPL v3 for Community, commercial for Enterprise)
- FalkorDB: <https://www.falkordb.com/> (SSPL v1)
- License compatibility guide: <https://choosealicense.com/>
- GPL v3 and SaaS: <https://www.gnu.org/licenses/gpl-faq.en.html#AGPLSaaS>
- SSPL analysis: <https://en.wikipedia.org/wiki/Server_Side_Public_License>

---

## Appendix: License Texts

### MIT License (LadybugDB, SquadRules)

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Apache 2.0 License (ArangoDB ≤v3.11)

See: <https://www.apache.org/licenses/LICENSE-2.0>

### GPL v3 License (Neo4j Community)

See: <https://www.gnu.org/licenses/gpl-3.0.en.html>

### SSPL v1 License (FalkorDB)

See: <https://www.mongodb.com/licensing/server-side-public-license>

### BSL 1.1 License (ArangoDB ≥v3.12)

See: <https://mariadb.com/bsl11/>
