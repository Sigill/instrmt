cmake_minimum_required(VERSION 2.8.12)
project(example-instrmt CXX)

find_package(Instrmt REQUIRED)

set(CMAKE_MODULE_PATH "${CMAKE_SOURCE_DIR}/../cmake;${CMAKE_MODULE_PATH}")
include(instrmt)

find_tracy()
find_itt()

add_executable(example-cpp example.cpp)
target_compile_definitions(example-cpp PRIVATE INSTRMT_ENABLE)
target_link_libraries(example-cpp PRIVATE instrmt)

add_executable(example-cpp-tty example.cpp)
use_tty_wrapper(example-cpp-tty)

add_executable(example-cpp-tracy example.cpp)
use_tracy_wrapper(example-cpp-tracy)

add_executable(example-cpp-itt example.cpp)
use_itt_wrapper(example-cpp-itt)
