cmake_minimum_required(VERSION 2.8.12)
project(example-instrmt CXX)

find_package(Instrmt REQUIRED)
add_executable(example example.cpp)
target_compile_definitions(example PRIVATE INSTRMT_ENABLE)
target_link_libraries(example PRIVATE instrmt)
