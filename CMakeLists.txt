cmake_minimum_required(VERSION 2.8.12)
project(Instrmt)

set(INSTRMT_VERSION "0.1.0")

include(GNUInstallDirs)
include(CMakePackageConfigHelpers)

set(INSTRMT_EXPORT InstrmtTargets)

function(instrmt_export_install_targets)
    install(TARGETS ${ARGN}
        EXPORT ${INSTRMT_EXPORT}
        LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
        ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
        PUBLIC_HEADER DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/instrmt
        )
endfunction()

function(instrmt_install_target e)
    install(TARGETS ${e} LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR})
endfunction()

add_library(instrmt SHARED src/instrmt.cxx)
target_compile_definitions(instrmt PRIVATE INSTRMT_ENABLE)
target_include_directories(instrmt
    PUBLIC $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
           $<INSTALL_INTERFACE:include>)

target_link_libraries(instrmt PRIVATE dl)

# Define public headers to get them automatically installed.
set_target_properties(instrmt PROPERTIES
    PUBLIC_HEADER include/instrmt/instrmt.hxx)

instrmt_export_install_targets(instrmt)

add_library(instrmt-tty MODULE src/instrmt-tty.cxx)
target_compile_definitions(instrmt-tty PRIVATE INSTRMT_ENABLE)
target_include_directories(instrmt-tty PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(instrmt-tty PRIVATE instrmt)

instrmt_install_target(instrmt-tty)

option(INSTRMT_BUILD_TRACY_ENGINE "" OFF)

if (INSTRMT_BUILD_TRACY_ENGINE)
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
        COMPILE_DEFINITIONS TRACY_ENABLE)

    add_library(instrmt-tracy MODULE src/instrmt-tracy.cxx)
    target_compile_definitions(instrmt-tracy PRIVATE INSTRMT_ENABLE)
    target_link_libraries(instrmt-tracy PRIVATE instrmt tracy)
    instrmt_install_target(instrmt-tracy)
endif()

option(INSTRMT_BUILD_ITT_ENGINE "" OFF)
if (INSTRMT_BUILD_ITT_ENGINE)
    set(VTUNE_LIB_SUFFIX "")
    if(CMAKE_SIZEOF_VOID_P MATCHES "8")
        set(VTUNE_LIB_DIR "lib64")
    else()
        set(VTUNE_LIB_DIR "lib32")
    endif()

    set(VTUNE_ROOT /opt/intel/vtune_profiler CACHE PATH "Root directory of VTune's profiler")

    find_library(ITTNOTIFY_LIBRARY ittnotify HINTS $ENV{VTUNE_ROOT}/${VTUNE_LIB_DIR} ${VTUNE_ROOT}/${VTUNE_LIB_DIR})
    find_path(ITTNOTIFY_INCLUDE_DIR ittnotify.h HINTS $ENV{VTUNE_ROOT}/include ${VTUNE_ROOT}/include)
    mark_as_advanced(ITTNOTIFY_LIBRARY ITTNOTIFY_INCLUDE_DIR)

    if (NOT ITTNOTIFY_LIBRARY OR NOT ITTNOTIFY_INCLUDE_DIR)
        message(FATAL_ERROR "Unable to find ittnotify library, please set VTUNE_ROOT")
    endif()

    add_library(ittnotify SHARED IMPORTED)
    set_target_properties(ittnotify PROPERTIES
        IMPORTED_LOCATION "${ITTNOTIFY_LIBRARY}"
        INTERFACE_INCLUDE_DIRECTORIES "${ITTNOTIFY_INCLUDE_DIR}"
        IMPORTED_LINK_INTERFACE_LIBRARIES "dl;pthread")

    add_library(instrmt-itt MODULE src/instrmt-itt.cxx)
    target_compile_definitions(instrmt-itt PRIVATE INSTRMT_ENABLE)
    target_link_libraries(instrmt-itt PRIVATE instrmt ittnotify)
    instrmt_install_target(instrmt-itt)
endif()

# Create the export file for the build tree.
export(TARGETS instrmt FILE "${PROJECT_BINARY_DIR}/${INSTRMT_EXPORT}.cmake")
# Create the export file for the install tree.
install(EXPORT ${INSTRMT_EXPORT} DESTINATION ".")

# The config files could be generated using a macro (see [1]), but it seems
# to be more complex than to do it manually (see [2]).
# [1] https://cmake.org/cmake/help/latest/module/CMakePackageConfigHelpers.html
# [2] https://gitlab.kitware.com/cmake/community/wikis/doc/tutorials/How-to-create-a-ProjectConfig.cmake-file

# Create the config file for the build tree.
set(CONF_INCLUDE_DIRS "${CMAKE_CURRENT_SOURCE_DIR}/include")
configure_file(InstrmtConfig.in.cmake
    "${PROJECT_BINARY_DIR}/InstrmtConfig.cmake" @ONLY)

# Create the config file for the install tree.
set(CONF_INCLUDE_DIRS "\${PACKAGE_CMAKE_DIR}/${CMAKE_INSTALL_INCLUDEDIR}")
configure_file(InstrmtConfig.in.cmake
    "${PROJECT_BINARY_DIR}${CMAKE_FILES_DIRECTORY}/InstrmtConfig.cmake" @ONLY)

# Create the package version file.
write_basic_package_version_file(
    "${CMAKE_CURRENT_BINARY_DIR}/InstrmtConfigVersion.cmake"
    VERSION "${INSTRMT_VERSION}"
    COMPATIBILITY SameMajorVersion)

# Install both the config and version file.
install(FILES
    "${PROJECT_BINARY_DIR}${CMAKE_FILES_DIRECTORY}/InstrmtConfig.cmake"
    "${CMAKE_CURRENT_BINARY_DIR}/InstrmtConfigVersion.cmake"
    DESTINATION "${CMAKE_INSTALL_PREFIX}")
