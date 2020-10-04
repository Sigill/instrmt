#include <benchmark/benchmark.h>

#include <instrmt-benchmarks-functions2.hxx>

void bm_function1000(benchmark::State& state) {
  for(auto _ : state) {
    function1000();
  }
}

BENCHMARK(bm_function1000)->Unit(benchmark::TimeUnit::kMicrosecond);


void bm_lmessage1000(benchmark::State& state) {
  for(auto _ : state) {
    for(int64_t i = 0; i < state.range(0); ++i)
      lmessage1000();
  }
}

BENCHMARK(bm_lmessage1000)->Unit(benchmark::TimeUnit::kMicrosecond)->Arg(1)->Arg(1000);


void bm_message1000(benchmark::State& state) {
  for(auto _ : state) {
    for(int64_t i = 0; i < state.range(0); ++i)
      message1000();
  }
}

BENCHMARK(bm_message1000)->Unit(benchmark::TimeUnit::kMicrosecond)->Arg(1)->Arg(1000);
