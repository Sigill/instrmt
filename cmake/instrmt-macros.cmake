function(find_tracy)
  set(TRACY_ROOT "" CACHE PATH "Root directory of Tracy")

  if(NOT OLD_TRACY_ROOT STREQUAL TRACY_ROOT)
    message("TRACY_ROOT was changed from ${OLD_TRACY_ROOT} to ${TRACY_ROOT}")
    set(OLD_VTUNE_ROOT ${VTUNE_ROOT} CACHE INTERNAL "Previous value for TRACY_ROOT")
    unset(TRACY_LIBRARY CACHE)
    unset(TRACY_INCLUDE_DIR CACHE)
  endif()

  find_library(TRACY_LIBRARY tracy HINTS $ENV{TRACY_ROOT}/lib ${TRACY_ROOT}/lib REQUIRED)
  find_path(TRACY_INCLUDE_DIR Tracy.hpp HINTS $ENV{TRACY_ROOT}/include ${TRACY_ROOT}/include REQUIRED)
  mark_as_advanced(TRACY_LIBRARY TRACY_INCLUDE_DIR)

  add_library(tracy SHARED IMPORTED)
  set_target_properties(tracy PROPERTIES
    IMPORTED_LOCATION "${TRACY_LIBRARY}"
    IMPORTED_NO_SONAME ON
    INTERFACE_INCLUDE_DIRECTORIES "${TRACY_INCLUDE_DIR}"
    IMPORTED_LINK_INTERFACE_LIBRARIES "dl;pthread"
    INTERFACE_COMPILE_DEFINITIONS TRACY_ENABLE)
endfunction()

function(find_itt)
  set(VTUNE_LIB_SUFFIX "")
  if(CMAKE_SIZEOF_VOID_P MATCHES "8")
    set(VTUNE_LIB_DIR "lib64")
  else()
    set(VTUNE_LIB_DIR "lib32")
  endif()

  set(VTUNE_ROOT /opt/intel/vtune_profiler CACHE PATH "Root directory of VTune's profiler")

  if(NOT OLD_VTUNE_ROOT STREQUAL VTUNE_ROOT)
    message("VTUNE_ROOT was changed from ${OLD_VTUNE_ROOT} to ${VTUNE_ROOT}")
    set(OLD_VTUNE_ROOT ${VTUNE_ROOT} CACHE INTERNAL "Previous value for VTUNE_ROOT")
    unset(ITTNOTIFY_LIBRARY CACHE)
    unset(ITTNOTIFY_INCLUDE_DIR CACHE)
  endif()

  find_library(ITTNOTIFY_LIBRARY ittnotify HINTS "${VTUNE_ROOT}" ENV VTUNE_ROOT PATH_SUFFIXES ${VTUNE_LIB_DIR} REQUIRED)
  find_path(ITTNOTIFY_INCLUDE_DIR ittnotify.h HINTS "${VTUNE_ROOT}" ENV VTUNE_ROOT PATH_SUFFIXES include REQUIRED)
  mark_as_advanced(ITTNOTIFY_LIBRARY ITTNOTIFY_INCLUDE_DIR)

  add_library(ittnotify STATIC IMPORTED)
  set_target_properties(ittnotify PROPERTIES
    IMPORTED_LOCATION "${ITTNOTIFY_LIBRARY}"
    INTERFACE_INCLUDE_DIRECTORIES "${ITTNOTIFY_INCLUDE_DIR}"
    IMPORTED_LINK_INTERFACE_LIBRARIES "dl;pthread")
endfunction()
