#!/bin/bash

function check_md5() {
  echo $2 $1 > $1.md5
  md5sum -c $1.md5
}


function download() {
  wget -q --no-check-certificate $1 -O "$2" &&
  check_md5 "$2" $3
}

function download_github() {
  download https://github.com/$1 "$2" $3
}

function extract() {
  mkdir -p $2 && tar -xzf $1 --strip-components=1 -C $2
}

export ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && cd .. && pwd )"
export HERE="$PWD"

mkdir -p vendor/tmp

function install_cmake2() {
  export cmake2_ver=2.8.12
  export cmake2_tar=$HERE/vendor/tmp/cmake-$cmake2_ver.tar.gz
  export cmake2_src=$HERE/vendor/tmp/cmake-$cmake2_ver-src
  export cmake2_bld=$HERE/vendor/tmp/cmake-$cmake2_ver-bld
  export cmake2_dep=$HERE/vendor/cmake2.8

  [ -d $cmake2_dep ] || {
    [ -d $cmake2_bld ] || {
      [ -d $cmake2_src ] || {
        [ -f $cmake2_tar ] || download_github Kitware/CMake/archive/v2.8.12.tar.gz $cmake2_tar 0dc2118e56f5c02dc5a90be9bd19befc &&
        extract $cmake2_tar $cmake2_src && patch -p1 -d $cmake2_src < "$ROOT/vendor/cmake2812-noqt.diff"
      } && ( mkdir -p $cmake2_bld && cd $cmake2_bld && $cmake2_src/bootstrap --parallel=$(nproc) --no-qt-gui --prefix=$cmake2_dep )
    } && make -C $cmake2_bld -j$(nproc) install
  }
}


function install_cmake3() {
  export cmake3_ver=3.18.0
  export cmake3_tar=$HERE/vendor/tmp/cmake-$cmake3_ver-Linux-x86_64.tar.gz
  export cmake3_dep=$HERE/vendor/cmake3

  [ -d $cmake3_dep ] || {
    [ -f $cmake3_tar ] || download_github Kitware/CMake/releases/download/v$cmake3_ver/cmake-$cmake3_ver-Linux-x86_64.tar.gz $cmake3_tar b777a4cb358153dc9b172ebf49426da0 &&
    mkdir -p $cmake3_dep && tar -xzf $cmake3_tar --strip-components=1 -C $cmake3_dep
  }
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
        [ -f $ittapi_tar ] || download_github intel/ittapi/archive/$ittapi_tag.tar.gz $ittapi_tar 5920c512a7a7c8971f2ffe6f693ffff3 &&
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
        [ -f $capstone_tar ] || download_github aquynh/capstone/archive/$capstone_ver.tar.gz $capstone_tar 8894344c966a948f1248e66c91b53e2c &&
        extract $capstone_tar $capstone_src && patch -p1 -d $capstone_src < "$ROOT/vendor/capstone-pkgconfig-includedir.diff"
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
        [ -f $glfw_tar ] || download_github glfw/glfw/archive/3.3.2.tar.gz $glfw_tar 865e54ff0a100e9041a40429db98be0b &&
        extract $glfw_tar $glfw_src
      } && ( mkdir -p $glfw_bld && cd $glfw_bld && cmake -DCMAKE_INSTALL_PREFIX=$glfw_dep -DCMAKE_BUILD_TYPE=Release $glfw_src )
    } && make -C $glfw_bld -j$(nproc) install
  }
}

function install_tracy() {
  export tracy_ver=0.7
  export tracy_tar=$HERE/vendor/tmp/tracy-$tracy_ver.tar.gz
  export tracy_src=$HERE/vendor/tmp/tracy-$tracy_ver-src
  export tracy_dep=$HERE/vendor/tracy
  export tracy_library=$tracy_dep/lib/libtracy.so
  export tracy_capture=$tracy_dep/bin/capture
  export tracy_profiler=$tracy_dep/bin/tracy

  test -n "$build_tracylib" && test -f $tracy_library && build_tracylib=
  test -n "$build_tracycapture" && test -f $tracy_capture && build_tracycapture=
  test -n "$build_tracyprofiler" && test -f $tracy_profiler && build_tracyprofiler=

  [ -z "$build_tracylib" -a -z "$build_tracycapture" -a -z "$build_tracyprofiler" ] || {
    [ -d $tracy_src ] || {
      [ -f $tracy_tar ] || download_github wolfpld/tracy/archive/v$tracy_ver.tar.gz $tracy_tar f00e6ca9f5e0858580d6546afce35a03 &&
      extract $tracy_tar $tracy_src && patch -p1 -d $tracy_src < "$ROOT/vendor/tracy-pkgconfig-static.diff"
    } &&
    {
      [ -z $build_tracylib ] || {
        mkdir -p $tracy_dep/lib $tracy_dep/include &&
        make -C $tracy_src/library/unix release
        cp $tracy_src/library/unix/libtracy-release.so $tracy_library &&
        cp -r $tracy_src/*.h $tracy_src/*.hpp $tracy_src/client $tracy_src/common $tracy_dep/include/
      }
    } && {
      [ -z $build_tracycapture ] || {
        mkdir -p $tracy_dep/bin &&
        make -C $tracy_src/capture/build/unix release &&
        cp $tracy_src/capture/build/unix/capture-release $tracy_capture
      }
    } && {
      [ -z $build_tracyprofiler ] || {
        mkdir -p $tracy_dep/bin &&
        PKG_CONFIG_PATH=$HERE/vendor/capstone/lib/pkgconfig:$HERE/vendor/glfw/lib/pkgconfig:$PKG_CONFIG_PATH make -C $tracy_src/profiler/build/unix release &&
        cp $tracy_src/profiler/build/unix/Tracy-release $tracy_profiler
      }
    }
  }
}

build_cmake2=
build_cmake3=
build_ittapi=
build_capstone=
build_glfw=
build_tracylib=
build_tracycapture=
build_tracyprofiler=

[ $# -eq 0 ] && build_ittapi=1 && build_tracylib=1

while (( "$#" )); do
  case "$1" in
    --cmake2)
      build_cmake2=1
      ;;
    --cmake3)
      build_cmake3=1
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

[ -n "$build_cmake2" ] && install_cmake2
[ -n "$build_cmake3" ] && install_cmake3
[ -n "$build_ittapi" ] && install_ittapi
[ -n "$build_capstone" ] && install_capstone
[ -n "$build_glfw" ] && install_glfw
[ -n "$build_tracylib" -o -n "$build_tracycapture" -o -n "$build_tracyprofiler" ] && install_tracy
