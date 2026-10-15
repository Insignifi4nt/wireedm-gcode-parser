"""Recompile every existing object reachable by the unchanged Replicad YAML.
Includes all discovered NCollections (a safe superset of link-time selection).
Calls the pinned compiler driver and retains its flags/PCH/object validation.
"""
from pathlib import Path
import argparse
import json
import multiprocessing
import os
from functools import partial
import sys

workspace = Path("/opencascade.js")
os.environ.update(json.loads((workspace / "build/build-flags.json").read_text()))
sys.path.insert(0, str(workspace / "src"))
import yaml
import compileBindings as compiler
from ocjs_bindgen.link.yaml_build import _load_full_manifest_symbols

config = yaml.safe_load(Path("/src/custom_build_single.yml").read_text())
symbols = {binding["symbol"] for binding in config["mainBuild"]["bindings"]}
symbols.update(_load_full_manifest_symbols(str(workspace / "build")))
parser = argparse.ArgumentParser()
parser.add_argument("--symbol", action="append", default=[])
requested = set(parser.parse_args().symbol)
assert requested <= symbols, "Explicit symbols must be reachable by the candidate configuration."
if requested:
    symbols = requested
files = [str(path) for path in sorted((workspace / "build/bindings").rglob("*.cpp"))
         if path.stem in symbols and Path(compiler._cpp_to_object_path(str(path))).is_file()]
assert files, "Pinned image must contain original selected compiled objects."
print(f"Recompiling {len(files)} selected existing binding objects; pinned OCCT static libraries untouched.", flush=True)
args = {"threading": "single-threaded", "identity_context": compiler._shared_identity_context()}
with multiprocessing.get_context("fork").Pool(processes=8) as pool:
    results = pool.map(partial(compiler.buildOneFile, args), files)
failures = [result for result in results if result["status"] == "failed"]
Path("/src/selected-binding-results.json").write_text(json.dumps(results, indent=2))
assert not failures, failures
print(f"Selected binding compilation passed: {len(results)} objects.", flush=True)
