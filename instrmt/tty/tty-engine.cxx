#include <instrmt/details/base.hxx>
#include <instrmt/details/engine.hxx>
#include <instrmt/details/utils.hxx>

#include <ctime>
#include <cstdio>
#include <cstring>
#include <string>
#include <iostream>
#include <iomanip>

#include <instrmt/tty/tty-utils.h>

using instrmt::ansi::style;

namespace {

const char tty_out_env[] = "INSTRMT_TTY_OUT";
const char tty_truncate_out_env[] = "INSTRMT_TTY_TRUNCATE_OUT";

enum class OpenMode { write, append };

std::ostream& operator<<(std::ostream& os, const OpenMode& mode) {
  return os << (mode == OpenMode::append ? "append" : "write");
}

class fopen_exception : public std::runtime_error {
public:
  fopen_exception(const std::string& file, int errcode)
    : std::runtime_error("unable to open " + file + " (" + std::strerror(errcode) + ")")
  {}
};

FILE* open_file(const std::string& filename, OpenMode mode) {
  FILE* f = fopen(filename.c_str(), mode == OpenMode::append ? "a" : "w");
  if (!f)
    throw fopen_exception(filename, errno);
  return f;
}

struct SinkConfig {
  FILE* file;
  std::string name;
  OpenMode mode;
  bool do_close;

  SinkConfig(FILE* f) noexcept
    : file(f)
    , name(f == stderr ? "stderr" : "stdout")
    , mode(OpenMode::write)
    , do_close(false)
  {}

  SinkConfig(std::string name, OpenMode mode)
    : file(open_file(name, mode))
    , name(std::move(name))
    , mode(mode)
    , do_close(true)
  {}

  SinkConfig(const SinkConfig&) = delete;
  SinkConfig(SinkConfig&& other) noexcept
    : file(std::exchange(other.file, nullptr))
    , name(std::move(other.name))
    , mode(std::move(other.mode))
    , do_close(std::exchange(other.do_close, false))
  {}

  SinkConfig& operator=(const SinkConfig&) = delete;
  SinkConfig& operator=(SinkConfig&& other) noexcept {
    if (do_close)
      fclose(file);
    file = std::exchange(other.file, nullptr);
    name = std::move(other.name);
    mode = std::move(other.mode);
    do_close = std::exchange(other.do_close, false);
    return *this;
  }

  ~SinkConfig() {
    if (do_close)
      fclose(file);
  }
};

std::string format_file(std::string fmt) {
  const auto date_pos = fmt.find("%date%");
  if (date_pos == std::string::npos)
    return fmt;

  std::time_t date = std::time(nullptr);
  char date_buf[32];
  std::strftime(date_buf, sizeof(date_buf), "%Y%m%d-%H%M%S", std::localtime(&date));

  fmt.replace(date_pos, 6, date_buf);
  return fmt;
}

SinkConfig make_sink() {
  using namespace std::string_literals;

  const char* env_sink = getenv(tty_out_env);

  if (env_sink == nullptr || env_sink == "stderr"s) {
    return stderr;
  } else if (env_sink == "stdout"s) {
    return stdout;
  } else {
    return {format_file(env_sink),
            getenv(tty_truncate_out_env) ? OpenMode::write : OpenMode::append};
  }
}

SinkConfig sink = stderr;

} // anonymous namespace

namespace instrmt {
namespace tty {

class Region : public instrmt::Region {
private:
  const char* name;
  double start;
  int color;

public:
  explicit Region(const char* name, int color);
  ~Region();
};

class RegionContext : public instrmt::RegionContext {
private:
  const char* name;
  int color;

public:
  explicit RegionContext(const char* name);

  Region* make_region_ptr() override;
};

Region::Region(const char* name, int color)
  : instrmt::Region()
  , name(name)
  , start(instrmt_get_time_ms())
  , color(color)
{}

Region::~Region()
{
  fprintf(sink.file, "\e[0;%dm%-40s \e[1;34m%.1f\e[0m ms\n", color, name, instrmt_get_time_ms() - start);
}

RegionContext::RegionContext(const char* name)
  : instrmt::RegionContext()
  , name(name)
  , color(instrmt_tty_string_color(name))
{}

Region*RegionContext::make_region_ptr()
{
  return new Region(name, color);
}

class LiteralMessageContext : public instrmt::LiteralMessageContext {
private:
  const char* msg;
  int color;

public:
  explicit LiteralMessageContext(const char* msg)
    : instrmt::LiteralMessageContext ()
    , msg(msg)
    , color(instrmt_tty_string_color(msg))
  {}

  void emit_message() const override {
    fprintf(sink.file, "\e[0;%dm%-40s\e[0m\n", color, msg);
  }
};

::instrmt::RegionContext* make_region_context(const char* name,
                                              const char* function,
                                              const char* /*file*/,
                                              int /*line*/)
{
  return new instrmt::tty::RegionContext(name ? name : function);
}

::instrmt::LiteralMessageContext* make_literal_message_context(const char* msg)
{
  return new instrmt::tty::LiteralMessageContext(msg);
}

void instrmt_dynamic_message(const char* msg)
{
  fprintf(sink.file, "\e[0;%dm%-40s\e[0m\n", instrmt_tty_string_color(msg), msg);
}

} // namespace tty
} // namespace instrmt

extern "C" {

instrmt::InstrmtEngine make_instrmt_engine() {
  try {
    sink = make_sink();
    std::cerr << style::green_fg << "[INSTRMT] TTY engine will " << sink.mode << " to: " << sink.name << "." << style::reset << "\n";
  } catch (const std::exception& ex) {
    std::cerr << style::red_bg << "[INSTRMT] TTY engine: " << ex.what() << ". Defaulting to stderr." << style::reset << "\n";
  }

  return {
    instrmt::tty::make_region_context,
    instrmt::tty::make_literal_message_context,
    instrmt::tty::instrmt_dynamic_message
  };
}

} // extern C
