"""Build a bounded, lazy Reader dictionary from Princeton WordNet 3.0.

Usage: python3 scripts/build-wordnet.py /path/to/WNdb-3.0.tar.gz
The archive is downloaded from https://wordnetcode.princeton.edu/3.0/ .
The generated asset is redistributed under licenses/WordNet-3.0.txt.
"""

import json
import re
import sys
import tarfile
from pathlib import Path

archive = Path(sys.argv[1])
out = Path(__file__).resolve().parents[1] / "src/dictionary/wordnet-data.js"
parts = {"noun": "noun", "verb": "verb", "adj": "adjective", "adv": "adverb"}
entries = {}

with tarfile.open(archive, "r:gz") as bundle:
    for part, label in parts.items():
        data = {}
        for line in bundle.extractfile(f"dict/data.{part}").read().decode("latin1").splitlines():
            if not re.match(r"^\d{8} ", line) or " | " not in line:
                continue
            offset = line[:8]
            gloss = line.split(" | ", 1)[1].split('; "', 1)[0].strip()
            data[offset] = gloss
        for line in bundle.extractfile(f"dict/index.{part}").read().decode("latin1").splitlines():
            fields = line.split()
            if len(fields) < 6 or not fields[2].isdigit():
                continue
            headword = fields[0].lower()
            if not re.fullmatch(r"[a-z]{2,24}", headword):
                continue
            senses = int(fields[2])
            if int(fields[-senses - 1]) < 1:
                continue
            definition = data.get(fields[-senses])
            if definition:
                entries.setdefault(headword, []).append([label, definition])

out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(
    "// Princeton WordNet 3.0, Copyright 2006 Princeton University.\n"
    "// Redistribution notice: licenses/WordNet-3.0.txt. Lazy-loaded.\n"
    + "export default " + json.dumps(dict(sorted(entries.items())), ensure_ascii=False, separators=(",", ":")) + ";\n",
    encoding="utf-8",
)
print(f"{len(entries)} headwords, {out.stat().st_size} bytes: {out}")
