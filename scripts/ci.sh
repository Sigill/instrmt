#!/usr/bin/env bash

set -e -x

ITTAPI_DIR=$PWD/vendor/ittapi-v3.25.5/lib/cmake/ittapi
TRACY_DIR=$PWD/vendor/tracy-v0.11.1/share/Tracy

TMP_DIR=$(mktemp -d /tmp/instrmt-XXXXXX)

cmake --preset=full -B "$TMP_DIR/build" -DCMAKE_INSTALL_PREFIX="$TMP_DIR/install" -DCMAKE_CXX_FLAGS=-Werror
cmake --build "$TMP_DIR/build" -j4 --target install

env -C "$TMP_DIR/build" ctest --output-on-failure

cmake -S example -B "$TMP_DIR/examples-from-build" \
  "-DInstrmt_DIR=$TMP_DIR/build" "-Dittapi_DIR=$ITTAPI_DIR" "-DTracy_DIR=$TRACY_DIR"
cmake --build "$TMP_DIR/examples-from-build" -j4

cmake -S example -B "$TMP_DIR/examples-from-install" \
  "-DInstrmt_DIR=$TMP_DIR/install/share/cmake/instrmt" "-Dittapi_DIR=$ITTAPI_DIR" "-DTracy_DIR=$TRACY_DIR"
cmake --build "$TMP_DIR/examples-from-install" -j4
