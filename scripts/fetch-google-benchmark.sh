#!/usr/bin/env bash
set -e -x

: "${VER:=v1.9.1}"
: "${VENDOR_DIR:=$PWD/vendor}"

ARCHIVE=$VENDOR_DIR/google-benchmark-${VER}.tar.gz
SRC_DIR=$VENDOR_DIR/google-benchmark-${VER}-src
BUILD_DIR=$VENDOR_DIR/google-benchmark-${VER}-build
INSTALL_DIR=$VENDOR_DIR/google-benchmark-${VER}

if ! test -d "$INSTALL_DIR"; then
  if ! test -d "$SRC_DIR"; then
    if ! test -f "$ARCHIVE"; then
      mkdir -p "$VENDOR_DIR"
      curl --fail --location --output "$ARCHIVE" "https://github.com/google/benchmark/archive/${VER}.tar.gz"
    fi

    mkdir -p "$SRC_DIR"
    tar -xzf "$ARCHIVE" -C "$SRC_DIR" --strip-components=1
  fi

  cmake -S "$SRC_DIR" -B "$BUILD_DIR" -DCMAKE_INSTALL_PREFIX="$INSTALL_DIR" -DCMAKE_BUILD_TYPE=Release -DBENCHMARK_ENABLE_TESTING=OFF
  cmake --build "$BUILD_DIR" --target install

  rm -rf "$SRC_DIR" "$BUILD_DIR"
fi
