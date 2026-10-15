#!/usr/bin/env bash
# Execute INSIDE the extracted pinned toolchain (or its official container).
set -euo pipefail
export PATH=/opencascade.js/.venv/bin:/usr/bin:/bin:/emsdk:/emsdk/upstream/emscripten:/emsdk/node/22.16.0_64bit/bin
export EMSDK=/emsdk OCCT_ROOT=/occt RAPIDJSON_ROOT=/rapidjson FREETYPE_ROOT=/freetype
export OCJS_OUTPUT_DIR=/src NX_DAEMON=false OCJS_CONFIG=single-threaded THREADING=single-threaded
export OCJS_SOURCE_COMMIT=ebd263f15337b440b391492af073662707e86482 SOURCE_DATE_EPOCH=1785713531
cd /opencascade.js
if [ "${1:-}" = selected-bindings ]; then
  shift
  exec python /src/compile-selected.py "$@"
fi
exec ./build-wasm.sh --config single-threaded "$@"
