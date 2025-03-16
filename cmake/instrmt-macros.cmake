function(find_itt_module)
  if(CMAKE_SIZEOF_VOID_P MATCHES "8")
    set(VTUNE_LIB_DIR "lib64")
  else()
    set(VTUNE_LIB_DIR "lib32")
  endif()

  find_library(ITTNOTIFY_LIBRARY ittnotify
    HINTS "${VTUNE_ROOT}" ENV VTUNE_ROOT
    PATH_SUFFIXES ${VTUNE_LIB_DIR} lib
    NO_CACHE
    REQUIRED
  )
  find_path(ITTNOTIFY_INCLUDE_DIR ittnotify.h
    HINTS "${VTUNE_ROOT}" ENV VTUNE_ROOT
    PATH_SUFFIXES include
    NO_CACHE
    REQUIRED
  )
  mark_as_advanced(ITTNOTIFY_LIBRARY ITTNOTIFY_INCLUDE_DIR)

  add_library(ittapi::ittnotify STATIC IMPORTED)
  set_target_properties(ittapi::ittnotify PROPERTIES
    IMPORTED_LINK_INTERFACE_LANGUAGES "C"
    IMPORTED_LOCATION "${ITTNOTIFY_LIBRARY}"
    INTERFACE_INCLUDE_DIRECTORIES "${ITTNOTIFY_INCLUDE_DIR}"
    INTERFACE_LINK_LIBRARIES "\$<LINK_ONLY:dl>"
  )
endfunction()

function(find_itt)
  if (DEFINED ittapi_DIR)
    find_package(ittapi REQUIRED CONFIG)
  else()
    set(VTUNE_ROOT /opt/intel/oneapi/vtune/latest/ CACHE PATH "Root directory of VTune's profiler")
    find_itt_module()
  endif()
endfunction()
