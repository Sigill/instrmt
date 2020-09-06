#include <benchmark/benchmark.h>

#include <instrmt-benchmarks-functions2.hxx>

void bm_instrmt1000(benchmark::State& state) {
  for(auto _ : state) {
    instrmt1000();
  }
}

BENCHMARK(bm_instrmt1000)->Unit(benchmark::TimeUnit::kMicrosecond);
