#include <instrmt/details/engine.hxx>

#include <iostream>
#include <dlfcn.h>

#include <instrmt/details/base.hxx>

namespace {

typedef instrmt::RegionContext* RegionContextFactory(const char* /*name*/,
                                                     const char* /*function*/,
                                                     const char* /*file*/,
                                                     int /*line*/);

void* handle = nullptr;
RegionContextFactory* region_context_factory = nullptr;

template<typename F>
F* load_function(const char* lib, const char* name) {
  // reset errors
  dlerror();

  // load the symbols
  F* f = (F*)dlsym(handle, name);
  const char* dlsym_error = dlerror();
  if (dlsym_error) {
    std::cerr << "\e[1;31mCannot load symbol " << name << " from " << lib << ": " << dlsym_error << "\e[0m\n";
  }

  return f;
}

int load_engine() {
  const char* engine_lib = getenv("INSTRMT_ENGINE");
  if (engine_lib == nullptr) {
    return 0;
  }

  handle = dlopen(engine_lib, RTLD_LAZY);
  if (handle == nullptr) {
    std::cerr << "\e[1;31mCannot load shared library " << engine_lib << ": " << dlerror() << "\e[0m\n";
    return 0;
  }

  region_context_factory = load_function<RegionContextFactory>(engine_lib, "make_region_context");

  return 1;
}

int engine_guard()
{
  static int g = load_engine();
  return g;
}

} // anonymous namespace

namespace instrmt {

std::unique_ptr<RegionContext> make_region_context(const char* name,
                                                   const char* function,
                                                   const char* file,
                                                   int line)
{
  (void)engine_guard();

  if (region_context_factory)
    return std::unique_ptr<RegionContext>(region_context_factory(name, function, file, line));
  else
    return {};
}

} // namespace instrmt
