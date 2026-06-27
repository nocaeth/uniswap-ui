#!/bin/bash

check() {
  if [[ "$2" != $3* ]]; then
    echo "Mismatched $1 version: Expected $3 but got $2"
    exit 1
  fi
}

# Check bun version
localBunVersion="$(bun --version)"
expectedBunVersion="$(cat "$(dirname "$0")/../.bun-version" | tr -d '\n')"
check "bun" $localBunVersion "$expectedBunVersion"

# Check node version
localNodeVersion="$(node --version)"
expectedNodeVersion="$(cat "$(dirname "$0")/../.nvmrc" | tr -d '\n' | cut -d'.' -f1)"
check "node" $localNodeVersion "$expectedNodeVersion"

echo "All versions match!"
