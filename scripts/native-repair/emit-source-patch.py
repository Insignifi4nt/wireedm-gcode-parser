"""Emit the exact four-file source diff from separately preserved originals."""
from pathlib import Path
import difflib
import sys

root = Path(sys.argv[1]).resolve()
originals = root.parent / "ownership-originals"
files = ["src/ocjs_bindgen/codegen/embind/class_.py", "src/ocjs_bindgen/embind_builtins.py",
         "src/patches/libembind-overloading.patch", "src/patches/libembind-overloading.expected.sha256"]
diff = "".join("".join(difflib.unified_diff((originals / name).read_text().splitlines(True),
               (root / "opencascade.js" / name).read_text().splitlines(True),
               fromfile="a/" + name, tofile="b/" + name)) for name in files)
assert diff and diff.count("--- a/") == 4
(root.parent / "ownership-backport.patch").write_text(diff)
