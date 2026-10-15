"""Backport PR50's coupled ownership repair to the exact ebd263f generator.

Run only on an extracted candidate image, not an installed application.
Produces a reviewable corresponding-source patch; preserves every original.
"""
from pathlib import Path
import difflib
import hashlib
import sys

root = Path(sys.argv[1]).resolve()
workspace = root / "opencascade.js"
originals = root.parent / "ownership-originals"
originals.mkdir(exist_ok=True)
changes = {}

def replace_once(text, old, new):
    assert text.count(old) == 1, f"Expected one pinned source match: {old[:80]}"
    return text.replace(old, new)

def update(relative, transform):
    path = workspace / relative
    old = path.read_text()
    backup = originals / relative
    backup.parent.mkdir(parents=True, exist_ok=True)
    assert not backup.exists(), "Do not overwrite preserved originals."
    backup.write_text(old)
    new = transform(old)
    assert old != new
    path.write_text(new)
    changes[relative] = (old, new)

helper = r'''
#include <type_traits>
#include <utility>

namespace ocjs {
  // Same SFINAE deletion test as upstream193f333: private destructors and
  // placement-only deletes stay untouched; ordinary deletes run normally.
  template <typename T, typename = void>
  struct is_deletable : std::false_type {};
  template <typename T>
  struct is_deletable<T, std::void_t<decltype(delete std::declval<T*>())>> : std::true_type {};
  template <typename T>
  void destroy(T* ptr) {
    if constexpr (is_deletable<T>::value) {
      delete ptr;
    }
  }
}
'''
update("src/ocjs_bindgen/codegen/embind/class_.py", lambda text:
       replace_once(text, "{ /* do nothing */ }", "{ ::ocjs::destroy(ptr); }"))
update("src/ocjs_bindgen/embind_builtins.py", lambda text:
       replace_once(text, "#include <emscripten/val.h>\n", "#include <emscripten/val.h>\n" + helper))

embind = root / "emsdk/upstream/emscripten/src/lib/libembind.js"
text = embind.read_text()
(originals / "patched-libembind.js").write_text(text)
text = replace_once(text, "          ptrType: this,\n          ptr,\n", "          ptrType: this,\n          ptr,\n          borrowed: !this.isReference,\n")
text = replace_once(text, "        ptrType: toType,\n        ptr: dp,\n      });", "        ptrType: toType,\n        ptr: dp,\n        borrowed: !this.isReference,\n      });")
text = replace_once(text, "  $runDestructor: ($$) => {\n", "  $runDestructor: ($$) => {\n    if ($$.borrowed) return;\n")
text = replace_once(text, "      smartPtrType: o.smartPtrType,\n", "      smartPtrType: o.smartPtrType,\n      borrowed: o.borrowed,\n")
text = replace_once(text, "          return body.apply(this, args);", "          var instance = body.apply(this, args);\n          if (instance && instance.$$) instance.$$.borrowed = false;\n          return instance;")
embind.write_text(text)
pristine = (workspace / "src/vendor/pristine-libembind.js").read_text()
combined_patch = "".join(difflib.unified_diff(pristine.splitlines(True), text.splitlines(True),
                        fromfile="src/lib/libembind.js", tofile="src/lib/libembind.js"))
update("src/patches/libembind-overloading.patch", lambda _: combined_patch)
update("src/patches/libembind-overloading.expected.sha256", lambda _:
       hashlib.sha256(text.encode()).hexdigest() + "\n")
patch = "".join("".join(difflib.unified_diff(old.splitlines(True), new.splitlines(True),
                  fromfile="a/" + path, tofile="b/" + path)) for path, (old, new) in changes.items())
(root.parent / "ownership-backport.patch").write_text(patch)
print(f"Backported paired ownership repair; {len(changes)} source files; "
      f"libembind SHA256 {hashlib.sha256(text.encode()).hexdigest()}")
