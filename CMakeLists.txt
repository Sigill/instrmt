cmake_minimum_required(VERSION 3.14)

include(cmake/in-source-guard.cmake)

cmake_policy(SET CMP0048 NEW)

project(
  Instrmt
  VERSION 0.1.0
  LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 14)

include(cmake/instrmt-macros.cmake)

# For convenience, write libraries and executables at the root of the build tree.
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})

# Main library
add_library(instrmt SHARED
  instrmt/details/engine.cxx
  instrmt/details/utils.cxx)

target_include_directories(instrmt
  PUBLIC $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
       $<INSTALL_INTERFACE:include>)

target_link_libraries(instrmt PRIVATE dl)

# TTY engine
add_library(instrmt-tty MODULE instrmt/tty/tty-engine.cxx)
target_link_libraries(instrmt-tty PRIVATE instrmt)

# TTY wrapper
add_library(instrmt-tty-wrapper INTERFACE)
target_include_directories(instrmt-tty-wrapper
  INTERFACE
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
  $<INSTALL_INTERFACE:include>
)
target_compile_definitions(instrmt-tty-wrapper INTERFACE "INSTRMT_CXX_WRAPPER=\"instrmt/tty/tty-wrapper.hxx\"")

option(INSTRMT_BUILD_ITT_ENGINE "" ON)
if (INSTRMT_BUILD_ITT_ENGINE)
  find_itt()

  # ITT engine
  add_library(instrmt-itt MODULE instrmt/itt/itt-engine.cxx)
  target_link_libraries(instrmt-itt PRIVATE instrmt ittapi::ittnotify)

  # ITT wrapper
  add_library(instrmt-itt-wrapper INTERFACE)
  target_include_directories(instrmt-itt-wrapper
    INTERFACE
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
    $<INSTALL_INTERFACE:include>
  )
  target_compile_definitions(instrmt-itt-wrapper INTERFACE "INSTRMT_CXX_WRAPPER=\"instrmt/itt/itt-wrapper.hxx\"")
  target_link_libraries(instrmt-itt-wrapper INTERFACE ittapi::ittnotify)
endif()

option(INSTRMT_BUILD_TRACY_ENGINE "" ON)
if (INSTRMT_BUILD_TRACY_ENGINE)
  find_package(Tracy)

  # Tracy engine
  add_library(instrmt-tracy MODULE instrmt/tracy/tracy-engine.cxx)
  target_link_libraries(instrmt-tracy PRIVATE instrmt Tracy::TracyClient)

  # Tracy wrapper
  add_library(instrmt-tracy-wrapper INTERFACE)
  target_include_directories(instrmt-tracy-wrapper
    INTERFACE
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
    $<INSTALL_INTERFACE:include>
  )
  target_compile_definitions(instrmt-tracy-wrapper INTERFACE "INSTRMT_CXX_WRAPPER=\"instrmt/tracy/tracy-wrapper.hxx\"" "TRACY_ENABLE")
  target_link_libraries(instrmt-tracy-wrapper INTERFACE Tracy::TracyClient)
endif()

# Install rules
if(NOT CMAKE_SKIP_INSTALL_RULES)
  include(cmake/install-rules.cmake)
endif()

# Tests
include(CTest)
if(BUILD_TESTING)
  add_subdirectory(test)
endif()

# Benchmarks
option(BUILD_BENCHMARKS "" ON)
if (BUILD_BENCHMARKS)
  add_subdirectory(benchmarks)
endif()
