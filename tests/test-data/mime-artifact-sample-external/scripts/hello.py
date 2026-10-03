#!/usr/bin/env python3
# squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
"""Hello world using conf/app-config.toml (MIME: text/x-python)."""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

_SAMPLE_ROOT = Path(__file__).resolve().parent.parent
ROOT = Path(os.environ.get("KAIROS_MIME_SAMPLE_ROOT", _SAMPLE_ROOT))


def read_toml_message(text: str) -> str:
    m = re.search(r'^\s*message\s*=\s*"([^"]*)"', text, re.MULTILINE)
    return m.group(1) if m else ""


def main() -> int:
    path = ROOT / "conf" / "app-config.toml"
    msg = read_toml_message(path.read_text(encoding="utf-8"))
    print(msg or "missing message in conf/app-config.toml", file=sys.stdout)
    return 0 if msg else 1


if __name__ == "__main__":
    raise SystemExit(main())