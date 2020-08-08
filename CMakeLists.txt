cmake_minimum_required(VERSION 2.8.12)
project(Instrmt)

set(INSTRMT_VERSION "0.1.0")

include(GNUInstallDirs)
set(CMAKE_INSTALL_CMAKEDIR "share/cmake" CACHE PATH "Install location for cmake related files")
mark_as_advanced(CMAKE_INSTALL_CMAKEDIR)

include(CMakePackageConfigHelpers)
include(CTest)

set(CMAKE_MODULE_PATH "${CMAKE_SOURCE_DIR}/cmake;${CMAKE_MODULE_PATH}")
include(instrmt)

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})

set(INSTRMT_EXPORT InstrmtTargets)

function(instrmt_export_install_targets)
    install(TARGETS ${ARGN}
        EXPORT ${INSTRMT_EXPORT}
        LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
        ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
        )
endfunction()

function(instrmt_install_target e)
    install(TARGETS ${e} LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR})
endfunction()

add_library(instrmt SHARED
    instrmt/details/engine.cxx)

set(INSTRMT_INCLUDE_DIRS "${CMAKE_CURRENT_SOURCE_DIR}")

target_include_directories(instrmt
    PUBLIC $<BUILD_INTERFACE:${INSTRMT_INCLUDE_DIRS}>
           $<INSTALL_INTERFACE:include>)

target_link_libraries(instrmt PRIVATE dl)

if(BUILD_TESTING)
    add_executable(example-cpp example/example.cpp)
    target_compile_definitions(example-cpp PRIVATE INSTRMT_ENABLE)
    target_link_libraries(example-cpp PRIVATE instrmt)
endif()

install(FILES
    instrmt/instrmt.hxx
    DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/instrmt)

install(FILES
    instrmt/details/utils.h
    instrmt/details/base.hxx
    instrmt/details/engine.hxx
    DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/instrmt/details)

instrmt_export_install_targets(instrmt)

# Create the export file for the build tree.
export(TARGETS instrmt FILE "${PROJECT_BINARY_DIR}/${INSTRMT_EXPORT}.cmake")
# Create the export file for the install tree.
install(EXPORT ${INSTRMT_EXPORT} DESTINATION "${CMAKE_INSTALL_CMAKEDIR}")

# The config files could be generated using a macro (see [1]), but it seems
# to be more complex than to do it manually (see [2]).
# [1] https://cmake.org/cmake/help/latest/module/CMakePackageConfigHelpers.html
# [2] https://gitlab.kitware.com/cmake/community/wikis/doc/tutorials/How-to-create-a-ProjectConfig.cmake-file

# Create the config file for the build tree.
set(CONF_INCLUDE_DIRS "${CMAKE_CURRENT_SOURCE_DIR}")
configure_file(InstrmtConfig.in.cmake
    "${PROJECT_BINARY_DIR}/InstrmtConfig.cmake" @ONLY)

# Create the config file for the install tree.
set(CONF_INCLUDE_DIRS "\${PACKAGE_CMAKE_DIR}/../../${CMAKE_INSTALL_INCLUDEDIR}")
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
    DESTINATION "${CMAKE_INSTALL_CMAKEDIR}")

add_subdirectory(instrmt/tty)

option(INSTRMT_BUILD_TRACY_ENGINE "" OFF)
add_subdirectory(instrmt/tracy)

option(INSTRMT_BUILD_ITT_ENGINE "" OFF)
add_subdirectory(instrmt/itt)
