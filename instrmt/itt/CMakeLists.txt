if (INSTRMT_BUILD_ITT_ENGINE)
    add_library(instrmt-itt MODULE itt-engine.cxx)
    target_link_libraries(instrmt-itt PRIVATE instrmt ittnotify)
    instrmt_install_target(instrmt-itt)

    install(FILES
        itt-wrapper.hxx
        DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/instrmt/itt)

    if(BUILD_TESTING)
        add_executable(example-cpp-itt ${CMAKE_SOURCE_DIR}/example/example.cpp)
        use_itt_wrapper(example-cpp-itt)
        add_test(NAME example-cpp-itt COMMAND example-cpp-itt)
    endif()
endif()
