function(find_tracy)
    set(TRACY_ROOT "" CACHE PATH "Root directory of Tracy")

    find_library(TRACY_LIBRARY tracy HINTS $ENV{TRACY_ROOT}/lib ${TRACY_ROOT}/lib)
    find_path(TRACY_INCLUDE_DIR Tracy.hpp HINTS $ENV{TRACY_ROOT}/include ${TRACY_ROOT}/include)
    mark_as_advanced(TRACY_LIBRARY TRACY_INCLUDE_DIR)

    if (NOT TRACY_LIBRARY OR NOT TRACY_INCLUDE_DIR)
        message(FATAL_ERROR "Unable to find Tracy's library, please set TRACY_ROOT")
    endif()

    add_library(tracy SHARED IMPORTED)
    set_target_properties(tracy PROPERTIES
        IMPORTED_LOCATION "${TRACY_LIBRARY}"
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
    find_library(ITTNOTIFY_LIBRARY ittnotify HINTS "${VTUNE_ROOT}" ENV VTUNE_ROOT PATH_SUFFIXES ${VTUNE_LIB_DIR})
    find_path(ITTNOTIFY_INCLUDE_DIR ittnotify.h HINTS "${VTUNE_ROOT}" ENV VTUNE_ROOT PATH_SUFFIXES include)
    mark_as_advanced(ITTNOTIFY_LIBRARY ITTNOTIFY_INCLUDE_DIR)

    if (NOT ITTNOTIFY_LIBRARY OR NOT ITTNOTIFY_INCLUDE_DIR)
        message(FATAL_ERROR "Unable to find ittnotify library, please set VTUNE_ROOT")
    endif()

    add_library(ittnotify STATIC IMPORTED)
    set_target_properties(ittnotify PROPERTIES
        IMPORTED_LOCATION "${ITTNOTIFY_LIBRARY}"
        INTERFACE_INCLUDE_DIRECTORIES "${ITTNOTIFY_INCLUDE_DIR}"
        IMPORTED_LINK_INTERFACE_LIBRARIES "dl;pthread")
endfunction()

function(use_tty_wrapper tgt)
    if ("${CMAKE_MAJOR_VERSION}" VERSION_LESS "3.0.0")
        # CMake 2.8 does nut support interface/header-only libraries
        target_include_directories(${tgt} PRIVATE "${INSTRMT_INCLUDE_DIRS}")
        target_compile_definitions(${tgt} PRIVATE "INSTRMT_CXX_WRAPPER=\"instrmt/tty/tty-wrapper.hxx\"")
    else()
        add_library(instrmt-tty-wrapper INTERFACE IMPORTED)
        set_target_properties(instrmt-tty-wrapper PROPERTIES
            INTERFACE_INCLUDE_DIRECTORIES "${INSTRMT_INCLUDE_DIRS}"
            INTERFACE_COMPILE_DEFINITIONS "INSTRMT_CXX_WRAPPER=\"instrmt/tty/tty-wrapper.hxx\"")
        target_link_libraries(${tgt} PRIVATE instrmt-tty-wrapper)
    endif()
endfunction()

function(use_tracy_wrapper tgt)
    add_library(instrmt-tracy-wrapper SHARED IMPORTED)
    set_target_properties(instrmt-tracy-wrapper PROPERTIES
        IMPORTED_LOCATION "${TRACY_LIBRARY}"
        INTERFACE_INCLUDE_DIRECTORIES "${TRACY_INCLUDE_DIR};${INSTRMT_INCLUDE_DIRS}"
        IMPORTED_LINK_INTERFACE_LIBRARIES "dl;pthread"
        INTERFACE_COMPILE_DEFINITIONS "TRACY_ENABLE;INSTRMT_CXX_WRAPPER=\"instrmt/tracy/tracy-wrapper.hxx\"")

    target_link_libraries(${tgt} PRIVATE instrmt-tracy-wrapper)
endfunction()

function(use_itt_wrapper tgt)
    add_library(instrmt-itt-wrapper SHARED IMPORTED)
    set_target_properties(instrmt-itt-wrapper PROPERTIES
        IMPORTED_LOCATION "${ITTNOTIFY_LIBRARY}"
        INTERFACE_INCLUDE_DIRECTORIES "${ITTNOTIFY_INCLUDE_DIR};${INSTRMT_INCLUDE_DIRS}"
        IMPORTED_LINK_INTERFACE_LIBRARIES "dl;pthread"
        INTERFACE_COMPILE_DEFINITIONS "INSTRMT_CXX_WRAPPER=\"instrmt/itt/itt-wrapper.hxx\"")

    target_link_libraries(${tgt} PRIVATE instrmt-itt-wrapper)
endfunction()
