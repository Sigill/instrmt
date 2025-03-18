#!/usr/bin/env bash
set -e -x

: "${VER:=v0.11.1}"

ARCHIVE=$PWD/vendor/tracy-${VER}.tar.gz
SRC_DIR=$PWD/vendor/tracy-${VER}-src
BUILD_DIR=$PWD/vendor/tracy-${VER}-build
INSTALL_DIR=$PWD/vendor/tracy-${VER}

BUILD_TOOLS=
while [[ $# -gt 0 ]]; do
  case $1 in
    --with-tools)
      BUILD_TOOLS=yes
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if ! {
  test -f "$INSTALL_DIR/lib/libTracyClient.a" && {
    test -z "$BUILD_TOOLS" || {
      test -f "$INSTALL_DIR/bin/tracy-capture" && test -f "$INSTALL_DIR/bin/tracy-profiler"
    }
  }
}; then
  if ! test -d "$SRC_DIR"; then
    if ! test -f "$ARCHIVE"; then
      curl --fail --location --output "$ARCHIVE" "https://github.com/wolfpld/tracy/archive/${VER}.tar.gz"
    fi

    mkdir -p "$SRC_DIR"
    tar -xzf "$ARCHIVE" -C "$SRC_DIR" --strip-components=1
  fi

  if ! test -f "$INSTALL_DIR/lib/libTracyClient.a"; then
    cmake -S "$SRC_DIR" -B "$BUILD_DIR" -DCMAKE_INSTALL_PREFIX="$INSTALL_DIR" -DCMAKE_BUILD_TYPE=Release -DCMAKE_POSITION_INDEPENDENT_CODE=ON
    cmake --build "$BUILD_DIR" -j4 --target install
  fi

  if test -n "$BUILD_TOOLS"; then
    mkdir -p "$INSTALL_DIR/bin/"

    if ! test -f "$INSTALL_DIR/bin/tracy-capture"; then
      cmake -S "$SRC_DIR/capture" -B "$BUILD_DIR-capture" -DCMAKE_BUILD_TYPE=Release
      cmake --build "$BUILD_DIR-capture" -j4
      cp "$BUILD_DIR-capture/tracy-capture" "$INSTALL_DIR/bin/"
    fi

    if ! test -f "$INSTALL_DIR/bin/tracy-profiler"; then
      cmake -S "$SRC_DIR/profiler" -B "$BUILD_DIR-profiler" -DCMAKE_BUILD_TYPE=Debug -DLEGACY=ON
      cmake --build "$BUILD_DIR-profiler" -j4
      cp "$BUILD_DIR-profiler/tracy-profiler" "$INSTALL_DIR/bin/"
    fi
  fi
fi
