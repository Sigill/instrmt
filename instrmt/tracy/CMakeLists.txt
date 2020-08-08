if (INSTRMT_BUILD_TRACY_ENGINE)
    find_tracy()

    add_library(instrmt-tracy MODULE tracy-engine.cxx)
    target_link_libraries(instrmt-tracy PRIVATE instrmt tracy)
    instrmt_install_target(instrmt-tracy)

    install(FILES
        tracy-wrapper.hxx
        DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/instrmt/tracy)

    if(BUILD_TESTING)
        add_executable(example-cpp-tracy ${CMAKE_SOURCE_DIR}/example/example.cpp)
        use_tracy_wrapper(example-cpp-tracy)
        add_test(NAME example-cpp-tracy COMMAND example-cpp-tracy)
    endif()
endif()
