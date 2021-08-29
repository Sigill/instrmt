find_package(benchmark REQUIRED)

function(instrmt_benchmark name)
  add_executable(${name}
    instrmt-benchmarks.cxx
    instrmt-benchmarks-functions.cxx
    instrmt-benchmarks-functions2.cxx)

  target_link_libraries(${name} PRIVATE benchmark::benchmark benchmark::benchmark_main)
endfunction()

instrmt_benchmark(instrmt-benchmarks)
target_link_libraries(instrmt-benchmarks PRIVATE instrmt)


instrmt_benchmark(instrmt-benchmarks-disable)
target_compile_definitions(instrmt-benchmarks-disable PRIVATE INSTRMT_DISABLE)
target_link_libraries(instrmt-benchmarks-disable PRIVATE instrmt)

instrmt_benchmark(instrmt-benchmarks-tty)
target_link_libraries(instrmt-benchmarks-tty PRIVATE instrmt-tty-wrapper)


if (INSTRMT_BUILD_ITT_ENGINE)
  instrmt_benchmark(instrmt-benchmarks-itt)
  target_link_libraries(instrmt-benchmarks-itt PRIVATE instrmt-itt-wrapper)
endif()


if (INSTRMT_BUILD_TRACY_ENGINE)
  instrmt_benchmark(instrmt-benchmarks-tracy)
  target_link_libraries(instrmt-benchmarks-tracy PRIVATE instrmt-tracy-wrapper)
endif()
