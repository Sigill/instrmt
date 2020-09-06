#!/bin/bash

export ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && cd .. && pwd )"
export HERE="$PWD"

PRETTY=
test -t 1 && PRETTY=color
RES_COL=60
MOVE_TO_COL="echo -en \\033[${RES_COL}G"
SETCOLOR_SUCCESS="echo -en \\033[1;32m"
SETCOLOR_FAILURE="echo -en \\033[1;31m"
SETCOLOR_ELLIPSIS="echo -en \\033[1;34m"
SETCOLOR_WARNING="echo -en \\033[1;33m"
SETCOLOR_NORMAL="echo -en \\033[0;39m"

function cmd() {
  echo "$@"
  "$@"
}

function OK() {
  [ -n "$PRETTY" ] && $MOVE_TO_COL
  echo -n "["
  [ -n "$PRETTY" ] && $SETCOLOR_SUCCESS
  echo -n $"  OK  "
  [ -n "$PRETTY" ] && $SETCOLOR_NORMAL
  echo "]"
  return 0
}

function KO() {
  [ -n "$PRETTY" ] && $MOVE_TO_COL
  echo -n "["
  [ -n "$PRETTY" ] && $SETCOLOR_FAILURE
  echo -n $"FAILED"
  [ -n "$PRETTY" ] && $SETCOLOR_NORMAL
  echo "]"
  [ $# -eq 1 ] && eval $1=1
  return 1
}

function info() {
  echo -e "\e[7;34m$1\e[0m"
}

function cmake_version() {
  cmake --version|head -n 1
}

function build_instrmt() {
   [ -d $2 ] || ( mkdir -p "$1" && cd "$1" && cmd cmake \
    -DINSTRMT_BUILD_TRACY_ENGINE=ON \
    -DINSTRMT_BUILD_ITT_ENGINE=ON \
    -DTRACY_ROOT=$HERE/vendor/tracy \
    -DVTUNE_ROOT=$HERE/vendor/ittapi \
    -DCMAKE_CXX_FLAGS=-std=c++14 \
    -DCMAKE_INSTALL_PREFIX=$2 \
    -DCMAKE_BUILD_TYPE=Release \
    $ROOT && make -j$(nproc) install )
}

function build_example() {
  info "Using $1"
  ( cd "$2" && cmd cmake \
    -DInstrmt_DIR="$1" \
    -DTRACY_ROOT=$HERE/vendor/tracy \
    -DVTUNE_ROOT=$HERE/vendor/ittapi \
    -DCMAKE_CXX_FLAGS=-std=c++14 \
    "$ROOT/example" && make -j$(nproc) )
}

function build_examples() {
  local status=0

  info "$(cmake_version)"
  build_instrmt $HERE/$1/instrmt/build $HERE/$1/instrmt/dist || KO status && OK &&
  {
    build_example $HERE/$1/instrmt/build $HERE/$1/example-build || KO status && OK
    build_example $HERE/$1/instrmt/dist/share/cmake $HERE/$1/example-dist || KO status && OK
  }

  return $status
}

mkdir -p 2.8/example-build 2.8/example-dist 3/example-build 3/example-dist

(
  export PATH=$HERE/vendor/cmake2.8/bin:$PATH
  build_examples 2.8
)

(
  export PATH=$HERE/vendor/cmake3/bin:$PATH
  build_examples 3
)
