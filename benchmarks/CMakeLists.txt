find_package(benchmark)


add_executable(instrmt-benchmarks
    instrmt-benchmarks.cxx
    instrmt-benchmarks-functions.cxx
    instrmt-benchmarks-functions2.cxx)

target_link_libraries(instrmt-benchmarks PRIVATE benchmark::benchmark benchmark::benchmark_main)
target_link_libraries(instrmt-benchmarks PRIVATE instrmt)
target_include_directories(instrmt-benchmarks PRIVATE .)


add_executable(instrmt-benchmarks-tty
    instrmt-benchmarks.cxx
    instrmt-benchmarks-functions.cxx
    instrmt-benchmarks-functions2.cxx)

target_link_libraries(instrmt-benchmarks-tty PRIVATE benchmark::benchmark benchmark::benchmark_main)
use_tty_wrapper(instrmt-benchmarks-tty)
target_include_directories(instrmt-benchmarks-tty PRIVATE .)


if (INSTRMT_BUILD_ITT_ENGINE)
    add_executable(instrmt-benchmarks-itt
        instrmt-benchmarks.cxx
        instrmt-benchmarks-functions.cxx
        instrmt-benchmarks-functions2.cxx)

    target_link_libraries(instrmt-benchmarks-itt PRIVATE benchmark::benchmark benchmark::benchmark_main)
    use_itt_wrapper(instrmt-benchmarks-itt)
    target_include_directories(instrmt-benchmarks-itt PRIVATE .)
endif()


if (INSTRMT_BUILD_TRACY_ENGINE)
    add_executable(instrmt-benchmarks-tracy
        instrmt-benchmarks.cxx
        instrmt-benchmarks-functions.cxx
        instrmt-benchmarks-functions2.cxx)

    target_link_libraries(instrmt-benchmarks-tracy PRIVATE benchmark::benchmark benchmark::benchmark_main)
    use_tracy_wrapper(instrmt-benchmarks-tracy)
    target_include_directories(instrmt-benchmarks-tracy PRIVATE .)
endif()
