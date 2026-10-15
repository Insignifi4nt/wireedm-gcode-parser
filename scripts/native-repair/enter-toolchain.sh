#!/usr/bin/env bash
# Daemonless WSL execution of the immutable OCI toolchain filesystem.
set -euo pipefail
candidate_root=$(realpath "$1")
shift
test -f "$candidate_root/opencascade.js/DEPS.json"
test -f "$candidate_root/src/run-pinned.sh"
sudo mount --bind /dev "$candidate_root/dev"
sudo mount -t proc proc "$candidate_root/proc"
trap 'sudo umount "$candidate_root/proc"; sudo umount "$candidate_root/dev"' EXIT
sudo chroot "$candidate_root" /bin/bash /src/run-pinned.sh "$@"
