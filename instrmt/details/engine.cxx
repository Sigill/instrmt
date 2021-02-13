#include <instrmt/details/engine.hxx>

#include <iostream>
#include <dlfcn.h>

#include <instrmt/details/base.hxx>
#include <instrmt/details/utils.hxx>

using instrmt::ansi::style;

namespace {

typedef instrmt::InstrmtEngine EngineFactory();

void* handle = nullptr;
instrmt::InstrmtEngine engine = {nullptr, nullptr, nullptr};

template<typename F>
F* load_function(const char* lib, const char* name) {
  // reset errors
  dlerror();

  // load the symbols
  F* f = (F*)dlsym(handle, name);
  const char* dlsym_error = dlerror();
  if (dlsym_error) {
    std::cerr << style::red_bg << "Cannot load symbol " << name << " from " << lib << ": " << dlsym_error << style::reset << "\n";
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
    std::cerr << style::red_bg << "Cannot load shared library " << engine_lib << "\n" << dlerror() << style::reset << "\n";
    return 0;
  }

  EngineFactory* make_engine = load_function<EngineFactory>(engine_lib, "make_instrmt_engine");
  if (make_engine)
    engine = make_engine();

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

  if (engine.region_context_factory)
    return std::unique_ptr<RegionContext>(engine.region_context_factory(name, function, file, line));
  else
    return {};
}

std::unique_ptr<LiteralMessageContext> make_literal_message_context(const char* msg)
{
  (void)engine_guard();

  if (engine.literal_message_context_factory)
    return std::unique_ptr<LiteralMessageContext>(engine.literal_message_context_factory(msg));
  else
    return {};
}

void emit_message(const char* msg) {
  (void)engine_guard();

  if (engine.dynamic_message_sender)
    engine.dynamic_message_sender(msg);
}

} // namespace instrmt
