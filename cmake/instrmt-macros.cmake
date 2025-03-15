function(find_itt)
  set(VTUNE_LIB_SUFFIX "")
  if(CMAKE_SIZEOF_VOID_P MATCHES "8")
    set(VTUNE_LIB_DIR "lib64")
  else()
    set(VTUNE_LIB_DIR "lib32")
  endif()

  set(VTUNE_ROOT /opt/intel/oneapi/vtune/latest/ CACHE PATH "Root directory of VTune's profiler")

  if(NOT OLD_VTUNE_ROOT STREQUAL VTUNE_ROOT)
    message("VTUNE_ROOT was changed from ${OLD_VTUNE_ROOT} to ${VTUNE_ROOT}")
    set(OLD_VTUNE_ROOT ${VTUNE_ROOT} CACHE INTERNAL "Previous value for VTUNE_ROOT")
    unset(ITTNOTIFY_LIBRARY CACHE)
    unset(ITTNOTIFY_INCLUDE_DIR CACHE)
  endif()

  find_library(ITTNOTIFY_LIBRARY ittnotify HINTS "${VTUNE_ROOT}" ENV VTUNE_ROOT PATH_SUFFIXES ${VTUNE_LIB_DIR} lib REQUIRED)
  find_path(ITTNOTIFY_INCLUDE_DIR ittnotify.h HINTS "${VTUNE_ROOT}" ENV VTUNE_ROOT PATH_SUFFIXES include REQUIRED)
  mark_as_advanced(ITTNOTIFY_LIBRARY ITTNOTIFY_INCLUDE_DIR)

  add_library(ittapi::ittnotify STATIC IMPORTED)
  set_target_properties(ittapi::ittnotify PROPERTIES
    IMPORTED_LINK_INTERFACE_LANGUAGES "C"
    IMPORTED_LOCATION "${ITTNOTIFY_LIBRARY}"
    INTERFACE_INCLUDE_DIRECTORIES "${ITTNOTIFY_INCLUDE_DIR}"
    INTERFACE_LINK_LIBRARIES "\$<LINK_ONLY:dl>")
endfunction()
