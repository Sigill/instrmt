#!/bin/bash

export ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && cd .. && pwd )"
export HERE="$PWD"

function OK() {
  echo -e "\e[5;7;32mOK\e[0m"
}

function KO() {
  echo -e "\e[5;7;31mOK\e[0m"
}

function info() {
  echo -e "\e[7;34m$1\e[0m"
}

function cmake_version() {
  cmake --version|head -n 1
}

function build_instrmt() {
   [ -d $2 ] || ( mkdir -p "$1" && cd "$1" && cmake \
    -DINSTRMT_BUILD_TRACY_ENGINE=ON \
    -DINSTRMT_BUILD_ITT_ENGINE=ON \
    -DTRACY_ROOT=$HERE/deps/tracy \
    -DVTUNE_ROOT=$HERE/deps/ittapi \
    -DCMAKE_CXX_FLAGS=-std=c++11 \
    -DCMAKE_INSTALL_PREFIX=$2 \
    -DCMAKE_BUILD_TYPE=Release \
    $ROOT && make install )
}

function build_example() {
  info "Using $1"
  ( cd "$2" && cmake \
    -DInstrmt_DIR="$1" \
    -DCMAKE_CXX_FLAGS=-std=c++11 \
    "$ROOT/tests/example" && make )
}

function build_examples() {
  info "$(cmake_version)"
  build_instrmt $HERE/$2/instrmt/build $HERE/$2/instrmt/dist &&
  (
    build_example $HERE/$2/instrmt/build $HERE/$2/example-build && OK || KO
    build_example $HERE/$2/instrmt/dist/share/cmake $HERE/$2/example-dist && OK || KO
  )
}

mkdir -p 2.8/example-build 2.8/example-dist 3/example-build 3/example-dist

(
  export PATH=$HERE/deps/cmake2.8/bin:$PATH
  build_examples $HERE/deps/cmake2.8/bin 2.8
)

(
  export PATH=$HERE/deps/cmake3/bin:$PATH
  build_examples $HERE/deps/cmake3/bin 3
)
