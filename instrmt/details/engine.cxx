#include <instrmt/details/engine.hxx>

#include <iostream>
#include <dlfcn.h>

#include <instrmt/details/base.hxx>

namespace {

typedef instrmt::RegionContext* RegionContextFactory(const char* /*name*/,
                                                     const char* /*function*/,
                                                     const char* /*file*/,
                                                     int /*line*/);

typedef instrmt::LiteralMessageContext* LiteralMessageContextFactory(const char* /*msg*/);

typedef void DynamicMessageSender(const char* /*msg*/);

void* handle = nullptr;
RegionContextFactory* region_context_factory = nullptr;
LiteralMessageContextFactory* literal_message_context_factory = nullptr;
DynamicMessageSender* dynamic_message_sender = nullptr;

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

  literal_message_context_factory = load_function<LiteralMessageContextFactory>(engine_lib, "make_literal_message_context");

  dynamic_message_sender = load_function<DynamicMessageSender>(engine_lib, "instrmt_dynamic_message");

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

std::unique_ptr<LiteralMessageContext> make_literal_message_context(const char* msg)
{
  (void)engine_guard();

  if (literal_message_context_factory)
    return std::unique_ptr<LiteralMessageContext>(literal_message_context_factory(msg));
  else
    return {};
}

void emit_message(const char* msg) {
  (void)engine_guard();

  if (dynamic_message_sender)
    dynamic_message_sender(msg);
}

} // namespace instrmt
