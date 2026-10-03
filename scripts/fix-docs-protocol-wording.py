#!/usr/bin/env python3
# squadrules-compat-surface: imports/references a retained prior-brand-named module or path (source filenames are an explicit non-goal)
"""
Doc wording pass: reduce kairos-forbidden-text/review-protocol-wording hits.
Skip lines with URL path /protocol/ (Keycloak OIDC). The `.agents/skills/**`
tree is exempt from the review-protocol-wording rule (see eslint/flat-config.cjs)
and is intentionally not processed here.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Order matters. Do not replace phrases already allowlisted in kairos-forbidden-text.cjs
# (e.g. protocol execution, protocol examples, mintable protocol, protocol surface, protocol chains).
SUBS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bprotocol engine\b", re.I), "adapter execution engine"),
    (re.compile(r"\bprotocol workflows\b", re.I), "adapter workflows"),
    (re.compile(r"\bprotocol workflow\b", re.I), "adapter workflow"),
    (re.compile(r"\bthe protocol runs\b", re.I), "the adapter run"),
    (re.compile(r"\bprotocol authoring\b", re.I), "adapter authoring"),
    (re.compile(r"\bKAIROS protocols\b", re.I), "SQUADRULES adapters"),
    (re.compile(r"\bbundle a protocol\b", re.I), "bundle an adapter"),
    (re.compile(r"\bprotocol markdown\b", re.I), "adapter markdown"),
    (re.compile(r"\bprotocol files\b", re.I), "adapter markdown files"),
    (re.compile(r"\bprotocol file\b", re.I), "adapter markdown file"),
    (re.compile(r"\bone protocol per\b", re.I), "one adapter per"),
    (re.compile(r"\bEvery protocol file\b", re.I), "Every adapter markdown file"),
    (re.compile(r"\bfor protocols\b", re.I), "for adapters"),
    (re.compile(r"\bShort protocol:\b", re.I), "Short adapter example:"),
    (re.compile(r"\bTwelve Step Linear Test Protocol\b", re.I), "Twelve Step Linear Test Adapter"),
    (re.compile(r"\btwelve step linear test protocol\b", re.I), "twelve step linear test adapter"),
    (re.compile(r"\btrain protocol\.md\b", re.I), "train adapter.md"),
    (re.compile(r"\bkairos train protocol\.md\b", re.I), "kairos train adapter.md"),
    (re.compile(r"\./protocols\b", re.I), "./adapters"),
    (re.compile(r"\bprotocol steps\b", re.I), "adapter layers"),
    (re.compile(r"\bprotocol text\b", re.I), "adapter markdown"),
    (re.compile(r"\bprotocol validation\b", re.I), "adapter structure validation"),
    (re.compile(r"\bprotocol output\b", re.I), "tool output"),
    (re.compile(r"\bprotocol editor\b", re.I), "adapter editor"),
    (re.compile(r"\bprotocol content\b", re.I), "adapter content"),
    (re.compile(r"\bprotocol view\b", re.I), "adapter view"),
    (re.compile(r"\bprotocol detail\b", re.I), "adapter detail"),
    (re.compile(r"\bprotocol title\b", re.I), "adapter title"),
    (re.compile(r"\bprotocol creation\b", re.I), "adapter creation"),
    (re.compile(r"\bnew protocol\b", re.I), "new adapter"),
    (re.compile(r"\bNew protocol\b", re.I), "New adapter"),
    (re.compile(r"\bpublic protocol\b", re.I), "public adapter"),
    (re.compile(r"\bprotocol UI\b", re.I), "adapter UI"),
    (re.compile(r"\bprotocol store\b", re.I), "adapter store"),
    (re.compile(r"# SQUADRULES protocol bundles\b", re.I), "# SQUADRULES adapter bundles"),
    (re.compile(r"\bprotocol bundles\b", re.I), "adapter bundles"),
    (re.compile(r"\bprotocol bundle\b", re.I), "adapter bundle"),
    (re.compile(r"\bprotocol version\b", re.I), "adapter version"),
    (re.compile(r"\bprotocol versions\b", re.I), "adapter versions"),
    (re.compile(r"\bprotocol layer\b", re.I), "adapter layer"),
    (re.compile(r"\bprotocol layers\b", re.I), "adapter layers"),
    (re.compile(r"\bprotocol run\b", re.I), "adapter run"),
    (re.compile(r"\bprotocol runs\b", re.I), "adapter runs"),
    (re.compile(r"\bprotocol design\b", re.I), "adapter design"),
    (re.compile(r"\bprotocol family\b", re.I), "adapter family"),
    (re.compile(r"\bprotocol families\b", re.I), "adapter families"),
    (re.compile(r"\bprotocol draft\b", re.I), "adapter draft"),
    (re.compile(r"\bprotocol drafts\b", re.I), "adapter drafts"),
    (re.compile(r"\bprotocol lifecycle\b", re.I), "adapter lifecycle"),
    (re.compile(r"\bprotocol metadata\b", re.I), "adapter metadata"),
    (re.compile(r"\bprotocol quality\b", re.I), "adapter quality"),
    (re.compile(r"\bprotocol search\b", re.I), "adapter search"),
    (re.compile(r"\bprotocol query\b", re.I), "activation query"),
    (re.compile(r"\bprotocol deletion\b", re.I), "adapter deletion"),
    (re.compile(r"\bprotocol delete\b", re.I), "adapter delete"),
    (re.compile(r"\bprotocol training\b", re.I), "adapter training"),
    (re.compile(r"\bprotocol train\b", re.I), "adapter train"),
    (re.compile(r"\bprotocol document\b", re.I), "adapter document"),
    (re.compile(r"\bprotocol documents\b", re.I), "adapter documents"),
    (re.compile(r"\bprotocol definition\b", re.I), "adapter definition"),
    (re.compile(r"\bprotocol definitions\b", re.I), "adapter definitions"),
    (re.compile(r"\bprotocol slug\b", re.I), "adapter slug"),
    (re.compile(r"\bprotocol slugs\b", re.I), "adapter slugs"),
    (re.compile(r"\bprotocol URI\b", re.I), "adapter URI"),
    (re.compile(r"\bprotocol URIs\b", re.I), "adapter URIs"),
    (re.compile(r"\bthe protocol\b", re.I), "the adapter"),
    (re.compile(r"\ba protocol\b", re.I), "an adapter"),
    (re.compile(r"\bA protocol\b", re.I), "An adapter"),
    (re.compile(r"\bArchitecture and protocol\b", re.I), "Architecture and adapter"),
]


SKIP_FILES: frozenset[Path] = frozenset()


def process_file(path: Path) -> bool:
    if path in SKIP_FILES:
        return False
    raw = path.read_text(encoding="utf-8")
    lines = raw.splitlines(keepends=True)
    out: list[str] = []
    changed = False
    for line in lines:
        if "://" in line and "/protocol/" in line:
            out.append(line)
            continue
        new_line = line
        for pat, rep in SUBS:
            new_line = pat.sub(rep, new_line)
        if new_line != line:
            changed = True
        out.append(new_line)
    if changed:
        path.write_text("".join(out), encoding="utf-8")
    return changed


def main() -> int:
    patterns = [
        "docs/**/*.md",
        "src/mcp-apps/**/*.md",
        "scripts/**/*.md",
        "README.md",
    ]
    for g in patterns:
        for path in sorted(ROOT.glob(g)):
            if path.is_dir():
                continue
            if process_file(path):
                print(path.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
