#!/usr/bin/env bash
set -e -x

: "${VER:=v3.25.5}"

ARCHIVE=$PWD/vendor/ittapi-${VER}.tar.gz
SRC_DIR=$PWD/vendor/ittapi-${VER}-src
BUILD_DIR=$PWD/vendor/ittapi-${VER}-build
INSTALL_DIR=$PWD/vendor/ittapi-${VER}

if ! test -d "$INSTALL_DIR"; then
  if ! test -d "$SRC_DIR"; then
    if ! test -f "$ARCHIVE"; then
      curl --fail --location --output "$ARCHIVE" "https://github.com/intel/ittapi/archive/${VER}.tar.gz"
    fi

    mkdir -p "$SRC_DIR"
    tar -xzf "$ARCHIVE" -C "$SRC_DIR" --strip-components=1
  fi

  cmake -S "$SRC_DIR" -B "$BUILD_DIR" -DCMAKE_INSTALL_PREFIX="$INSTALL_DIR" -DCMAKE_BUILD_TYPE=Release
  cmake --build "$BUILD_DIR" --target install
fi
