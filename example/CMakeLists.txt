cmake_minimum_required(VERSION 3.0.0)
project(instrmt-example LANGUAGES CXX)

find_package(Instrmt REQUIRED)

include(../cmake/instrmt-macros.cmake)

find_tracy()
find_itt()

add_executable(example-cpp example.cpp)
target_compile_definitions(example-cpp PRIVATE INSTRMT_ENABLE)
target_link_libraries(example-cpp PRIVATE instrmt)

add_executable(example-cpp-tty example.cpp)
target_link_libraries(example-cpp-tty instrmt-tty-wrapper)

add_executable(example-cpp-itt example.cpp)
target_link_libraries(example-cpp-itt instrmt-itt-wrapper)

add_executable(example-cpp-tracy example.cpp)
target_link_libraries(example-cpp-tracy instrmt-tracy-wrapper)
