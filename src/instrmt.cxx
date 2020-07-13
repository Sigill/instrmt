#include "instrmt/instrmt.hxx"

#include <iostream>
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>

namespace {

class EngineBuilder : public instrmt::Engine {
public:
  using instrmt::Engine::handle;
  using instrmt::Engine::region_context_factory;
  using instrmt::Engine::message_context_factory;
};

instrmt::Engine load_telemetry_engine() {
  EngineBuilder e;

  const char* engine_lib = getenv("INSTRMT_ENGINE");
  if (engine_lib == nullptr) {
    return e;
  }

  e.handle = dlopen(engine_lib, RTLD_LAZY);
  if (e.handle == nullptr) {
    std::cerr << "\e[1;31mCannot load shared library " << engine_lib << ": " << dlerror() << "\e[0m\n";
    return e;
  }

  {
    // reset errors
    dlerror();

    // load the symbols
    e.region_context_factory = (instrmt::RegionContextFactory*)dlsym(e.handle, "make_region_context");
    const char* dlsym_error = dlerror();
    if (dlsym_error) {
      std::cerr << "\e[1;31mCannot load symbol make_region_context from " << engine_lib << ": " << dlerror() << "\e[0m\n";
    }
  }

  {
    // reset errors
    dlerror();

    // load the symbols
    e.message_context_factory = (instrmt::MessageContextFactory*)dlsym(e.handle, "make_message_context");
    const char* dlsym_error = dlerror();
    if (dlsym_error) {
      std::cerr << "\e[1;31mCannot load symbol make_message_context from " << engine_lib << ": " << dlerror() << "\e[0m\n";
    }
  }

  return e;
}

} // anonymous namespace

namespace instrmt {

std::unique_ptr<RegionContext> Engine::make_region_context(const char* name,
                                                           const char* function,
                                                           const char* file,
                                                           int line) const
{
  if (region_context_factory)
    return std::unique_ptr<RegionContext>(region_context_factory(name, function, file, line));
  else
    return {};
}

std::unique_ptr<MessageContext> Engine::make_message_context(const char* msg) const
{
  if (message_context_factory)
    return std::unique_ptr<MessageContext>(message_context_factory(msg));
  else
    return {};
}

const Engine&engine()
{
  static Engine e = load_telemetry_engine();
  return e;
}

std::unique_ptr<Region> RegionContext::make_region()
{
  return std::unique_ptr<Region>(make_region_ptr());
}

} // namespace instrmt
