add_library(instrmt-tty MODULE tty-engine.cxx)
target_include_directories(instrmt-tty PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(instrmt-tty PRIVATE instrmt)

instrmt_install_target(instrmt-tty)

install(FILES
    tty-utils.h
    tty-wrapper.hxx
    DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/instrmt/tty)

if(BUILD_TESTING)
    add_executable(example-cpp-tty "../../example/example.cpp")
    use_tty_wrapper(example-cpp-tty)
    add_test(NAME example-cpp-tty COMMAND example-cpp-tty)
endif()
