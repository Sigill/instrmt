#!/bin/bash

function check_md5() {
  echo "$2 *$1" | md5sum -c
}

function download() {
  [ -f "$2" ] || wget -q --no-check-certificate $1 -O "$2" && check_md5 "$2" "$3"
}

function extract() {
  mkdir -p "$2" && tar -xf "$1" --strip-components=1 -C "$2"
}

export ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && cd .. && pwd )"
export HERE="$PWD"

mkdir -p vendor/tmp

function install_cmake2() {
  export cmake_tar=$HERE/vendor/tmp/cmake-$cmake_ver.tar.gz
  export cmake_src=$HERE/vendor/tmp/cmake-$cmake_ver-src
  export cmake_bld=$HERE/vendor/tmp/cmake-$cmake_ver-bld
  export cmake_dep=$HERE/vendor/cmake-$cmake_ver

  [ -d $cmake_dep ] || {
    [ -d $cmake_bld ] || {
      [ -d $cmake_src ] || {
        download https://github.com/Kitware/CMake/archive/v2.8.12.tar.gz $cmake_tar 0dc2118e56f5c02dc5a90be9bd19befc &&
        extract $cmake_tar $cmake_src && patch -p1 -d $cmake_src -i "$ROOT/vendor/cmake2812-noqt.diff"
      } && ( mkdir -p $cmake_bld && cd $cmake_bld && $cmake_src/bootstrap --parallel=$(nproc) --no-qt-gui --prefix=$cmake_dep )
    } && make -C $cmake_bld -j$(nproc) install
  }
}


function install_cmake3() {
  export cmake_tar=$HERE/vendor/tmp/cmake-$cmake_ver-Linux-x86_64.tar.gz
  export cmake_dep=$HERE/vendor/cmake-$cmake_ver

  [ -d $cmake_dep ] || {
    download https://github.com/Kitware/CMake/releases/download/v$cmake_ver/cmake-$cmake_ver-Linux-x86_64.tar.gz $cmake_tar $cmake_md5 &&
    extract $cmake_tar $cmake_dep
  }
}


function install_cmake() {
  if [ -z "$cmake_ver" ]; then
    export cmake_ver=3.20.0
  fi

  case "$cmake_ver" in
    2.8.12)
      export cmake_md5=0dc2118e56f5c02dc5a90be9bd19befc
      install_cmake2
      ;;
    3.20.0)
      export cmake_md5=9775844c038dd0b2ed80bce4747ba6bf
      install_cmake3
      ;;
    *)
      2> echo "Unsupported cmake version: $cmake_ver"
      exit -1
      ;;
  esac
}


function install_ittapi() {
  export ittapi_tag=8cd2618
  export ittapi_tar=$HERE/vendor/tmp/ittapi-$ittapi_tag.tar.gz
  export ittapi_src=$HERE/vendor/tmp/ittapi-$ittapi_tag-src
  export ittapi_bld=$HERE/vendor/tmp/ittapi-$ittapi_tag-bld
  export ittapi_dep=$HERE/vendor/ittapi

  [ -d $ittapi_dep ] || {
    [ -d $ittapi_bld ] || {
      [ -d $ittapi_src ] || {
        download https://github.com/intel/ittapi/archive/$ittapi_tag.tar.gz $ittapi_tar 5920c512a7a7c8971f2ffe6f693ffff3 &&
        extract $ittapi_tar $ittapi_src
      } && ( mkdir -p $ittapi_bld && cd $ittapi_bld && cmake -DCMAKE_BUILD_TYPE=Release $ittapi_src )
    } && {
      make -C $ittapi_bld -j$(nproc) &&
      mkdir -p $ittapi_dep/lib64 &&
      cp $ittapi_bld/bin/libittnotify.a $ittapi_dep/lib64/ &&
      cp -r $ittapi_src/include $ittapi_dep/
    }
  }
}


function install_capstone() {
  export capstone_ver=4.0.2
  export capstone_tar=$HERE/vendor/tmp/capstone-$capstone_ver.tar.gz
  export capstone_src=$HERE/vendor/tmp/capstone-$capstone_ver-src
  export capstone_bld=$HERE/vendor/tmp/capstone-$capstone_ver-bld
  export capstone_dep=$HERE/vendor/capstone

  [ -d $capstone_dep ] || {
    [ -d $capstone_bld ] || {
      [ -d $capstone_src ] || {
        download https://github.com/aquynh/capstone/archive/$capstone_ver.tar.gz $capstone_tar 8894344c966a948f1248e66c91b53e2c &&
        extract $capstone_tar $capstone_src && patch -p1 -d $capstone_src -i "$ROOT/vendor/capstone-pkgconfig-includedir.diff"
      } && ( mkdir -p $capstone_bld && cd $capstone_bld && cmake -DCMAKE_INSTALL_PREFIX=$capstone_dep -DCMAKE_BUILD_TYPE=Release $capstone_src )
    } &&
    make -C $capstone_bld -j$(nproc) install &&
    rm $capstone_dep/lib/libcapstone.so* # When building tracy-profiler, will force the use of libcapstone.a
  }
}


function install_glfw() {
  export glfw_ver=3.3.2
  export glfw_tar=$HERE/vendor/tmp/glfw-$glfw_ver.tar.gz
  export glfw_src=$HERE/vendor/tmp/glfw-$glfw_ver-src
  export glfw_bld=$HERE/vendor/tmp/glfw-$glfw_ver-bld
  export glfw_dep=$HERE/vendor/glfw

  [ -d $glfw_dep ] || {
    [ -d $glfw_bld ] || {
      [ -d $glfw_src ] || {
        download https://github.com/glfw/glfw/archive/3.3.2.tar.gz $glfw_tar 865e54ff0a100e9041a40429db98be0b &&
        extract $glfw_tar $glfw_src
      } && ( mkdir -p $glfw_bld && cd $glfw_bld && cmake -DCMAKE_INSTALL_PREFIX=$glfw_dep -DCMAKE_BUILD_TYPE=Release $glfw_src )
    } && make -C $glfw_bld -j$(nproc) install && sed -i 's/Requires.private:  x11/Requires:  x11/g' "$HERE/vendor/glfw/lib/pkgconfig/glfw3.pc"
  }
}

function install_tracy_version() {
  export tracy_tar=$HERE/vendor/tmp/tracy-$tracy_ver.tar.gz
  export tracy_src=$HERE/vendor/tmp/tracy-$tracy_ver-src
  export tracy_dep=$HERE/vendor/tracy-$tracy_ver
  export tracy_library=$tracy_dep/lib/libtracy.so
  export tracy_capture=$tracy_dep/bin/capture
  export tracy_profiler=$tracy_dep/bin/tracy

  test -n "$build_tracylib" && test -f $tracy_library && build_tracylib=
  test -n "$build_tracycapture" && test -f $tracy_capture && build_tracycapture=
  test -n "$build_tracyprofiler" && test -f $tracy_profiler && build_tracyprofiler=

  [ -z "$build_tracylib" -a -z "$build_tracycapture" -a -z "$build_tracyprofiler" ] || {
    [ -d $tracy_src ] || {
      download https://github.com/wolfpld/tracy/archive/v$tracy_ver.tar.gz $tracy_tar $tracy_md5 &&
      extract $tracy_tar $tracy_src &&
      [ "$tracy_ver" != "0.7" -a "$tracy_ver" != "0.7.2" ] || patch -p1 -d $tracy_src -i "$ROOT/vendor/tracy-pkgconfig-static.diff" &&
      [ "$tracy_ver" != "0.7.6" ] || sed -i 's/capstone.h/capstone\/capstone.h/g' "$tracy_src/server/TracyWorker.cpp" "$tracy_src/server/TracySourceView.cpp"
    } &&
    {
      [ -z $build_tracylib ] || {
        mkdir -p $tracy_dep/lib $tracy_dep/include &&
        make -C $tracy_src/library/unix -j$(nproc) release
        cp $tracy_src/library/unix/libtracy-release.so $tracy_library &&
        cp -r $tracy_src/*.h $tracy_src/*.hpp $tracy_src/client $tracy_src/common $tracy_dep/include/
      }
    } && {
      [ -z $build_tracycapture ] || {
        mkdir -p $tracy_dep/bin &&
        PKG_CONFIG_PATH=$HERE/vendor/capstone/lib/pkgconfig make -C $tracy_src/capture/build/unix -j$(nproc) release &&
        cp $tracy_src/capture/build/unix/capture-release $tracy_capture
      }
    } && {
      [ -z $build_tracyprofiler ] || {
        mkdir -p $tracy_dep/bin &&
        PKG_CONFIG_PATH=$HERE/vendor/capstone/lib/pkgconfig:$HERE/vendor/glfw/lib/pkgconfig:$PKG_CONFIG_PATH make -C $tracy_src/profiler/build/unix -j$(nproc) release &&
        cp $tracy_src/profiler/build/unix/Tracy-release $tracy_profiler
      }
    }
  }
}

function install_tracy() {
  if [ -z "$tracy_ver" ]; then
    export tracy_ver=0.7.6
  fi

  case "$tracy_ver" in
    0.7)
      export tracy_md5=f00e6ca9f5e0858580d6546afce35a03
      ;;
    0.7.2)
      export tracy_md5=bceb615c494c3f7ccb77ba3bae20b216
      ;;
    0.7.3)
      export tracy_md5=998be6c60079083aeb145e19cb24d2ee
      ;;
    0.7.4)
      export tracy_md5=70f9b143d1d6ce84b59d49a275a5646c
      ;;
    0.7.5)
      export tracy_md5=99cd76bc4ae9028623b256a9ef21f629
      ;;
    0.7.6)
      export tracy_md5=828be21907a1bddf5762118cf9e3ff66
      ;;
    *)
      2> echo "Unsupported tracy version: $tracy_ver"
      exit -1
      ;;
  esac

  install_tracy_version
}

build_cmake=
build_ittapi=
build_capstone=
build_glfw=
build_tracylib=
build_tracycapture=
build_tracyprofiler=

[ $# -eq 0 ] && build_ittapi=1 && build_tracylib=1

while (( "$#" )); do
  case "$1" in
    --cmake)
      build_cmake=1
      ;;
    --ittapi)
      build_ittapi=1
      ;;
    --capstone)
      build_capstone=1
      ;;
    --glfw)
      build_glfw=1
      ;;
    --tracy)
      build_tracylib=1
      ;;
    --tracy-capture)
      build_tracycapture=1
      ;;
    --tracy-profiler)
      build_tracyprofiler=1
      build_capstone=1
      build_glfw=1
      ;;
    *)
      2> echo "Unsupported option: $1"
      exit -1
      ;;
  esac
  shift
done

[ -z "$build_cmake" ] || install_cmake || exit -1
[ -z "$build_ittapi" ] || install_ittapi || exit -1
[ -z "$build_capstone" ] || install_capstone || exit -1
[ -z "$build_glfw" ] || install_glfw || exit -1
[ -z "$build_tracylib" -a -z "$build_tracycapture" -a -z "$build_tracyprofiler" ] || install_tracy || exit -1

exit 0
