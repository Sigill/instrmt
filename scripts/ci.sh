#!/usr/bin/env bash

set -e -x

export VENDOR_DIR=${VENDOR_DIR:-$PWD/vendor}
WORK_DIR=${WORK_DIR:-/tmp}

mkdir -p "$WORK_DIR"

./scripts/fetch-google-benchmark.sh
./scripts/fetch-ittapi.sh
./scripts/fetch-tracy.sh

ITTAPI_DIR=$VENDOR_DIR/ittapi-v3.25.5/lib/cmake/ittapi
TRACY_DIR=$VENDOR_DIR/tracy-v0.11.1/share/Tracy

cmake --version

cmake --preset=ci -B "$WORK_DIR/instrmt-build" -DCMAKE_INSTALL_PREFIX="$WORK_DIR/instrmt-install"

cmake --build "$WORK_DIR/instrmt-build" -j4 --target install

env -C "$WORK_DIR/instrmt-build" ctest --output-on-failure

cmake -S example -B "$WORK_DIR/instrmt-from-build-tree" \
  "-Dittapi_DIR=$ITTAPI_DIR" "-DTracy_DIR=$TRACY_DIR" "-DInstrmt_DIR=$WORK_DIR/instrmt-build"
cmake --build "$WORK_DIR/instrmt-from-build-tree" -j4

cmake -S example -B "$WORK_DIR/instrmt-from-install-tree" \
  "-Dittapi_DIR=$ITTAPI_DIR" "-DTracy_DIR=$TRACY_DIR" "-DInstrmt_DIR=$WORK_DIR/instrmt-install/share/cmake/instrmt"
cmake --build "$WORK_DIR/instrmt-from-install-tree" -j4

rm -rf \
  "$WORK_DIR/instrmt-build" \
  "$WORK_DIR/instrmt-install" \
  "$WORK_DIR/instrmt-from-build-tree" \
  "$WORK_DIR/instrmt-from-install-tree"
