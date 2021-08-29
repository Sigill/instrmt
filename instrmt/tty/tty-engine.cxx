#include <instrmt/details/base.hxx>
#include <instrmt/details/engine.hxx>
#include <instrmt/details/utils.hxx>

#include <ctime>
#include <cstdio>
#include <cstring>
#include <string>
#include <iostream>
#include <unistd.h>

#include "tty-utils.h"

using instrmt::ansi::style;

namespace {

const char tty_out_env[] = "INSTRMT_TTY_OUT";
const char tty_truncate_out_env[] = "INSTRMT_TTY_TRUNCATE_OUT";
const char tty_color_env[] = "INSTRMT_TTY_COLOR";
const char tty_format_env[] = "INSTRMT_TTY_FORMAT";

template<typename Target>
Target lexical_cast(const std::string& value);

template<typename Target>
Target parse_env(const char* e, Target def) {
  const char* value = getenv(e);
  if (value == nullptr)
    return def;
  return lexical_cast<Target>(value);
}

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

template<>
bool lexical_cast(const std::string& value) {
  if (value == "yes")
    return true;
  if (value == "no")
    return false;
  throw std::runtime_error("invalid boolean value: " + value);
}

enum class ColorMode {No, Auto, Yes};

template<>
ColorMode lexical_cast(const std::string& str) {
  if (str == "auto")
    return ColorMode::Auto;

  try {
    return lexical_cast<bool>(str) ? ColorMode::Yes : ColorMode::No;
  } catch (...) {
    throw std::runtime_error("invalid color mode: " + str);
  }
}

bool has_color_support(FILE* f) {
  return ::isatty(fileno(f));
}

enum class OutputFormat { text, csv };
template<>
OutputFormat lexical_cast(const std::string& str) {
  if (str == "text")
    return OutputFormat::text;
  if (str == "csv")
    return OutputFormat::csv;

  throw std::runtime_error("invalid output format: " + str);
}

std::ostream& operator<<(std::ostream& os, const OutputFormat& mode) {
  return os << (mode == OutputFormat::text ? "text" : "csv");
}

struct Sink {
  FILE* file;
  std::string name;
  OpenMode mode;
  bool do_close;
  bool color_support;

  Sink(FILE* f) noexcept
    : file(f)
    , name(f == stderr ? "stderr" : "stdout")
    , mode(OpenMode::write)
    , do_close(false)
    , color_support(false)
  {}

  Sink(std::string name, OpenMode mode)
    : file(open_file(name, mode))
    , name(std::move(name))
    , mode(mode)
    , do_close(true)
    , color_support(false)
  {}

  Sink(const Sink&) = delete;
  Sink(Sink&& other) noexcept
    : file(std::exchange(other.file, nullptr))
    , name(std::move(other.name))
    , mode(std::move(other.mode))
    , do_close(std::exchange(other.do_close, false))
    , color_support(std::move(other.color_support))
  {}

  Sink& operator=(const Sink&) = delete;
  Sink& operator=(Sink&& other) noexcept {
    if (do_close)
      fclose(file);
    file = std::exchange(other.file, nullptr);
    name = std::move(other.name);
    mode = std::move(other.mode);
    do_close = std::exchange(other.do_close, false);
    color_support = std::move(other.color_support);
    return *this;
  }

  void configure_color_support(ColorMode mode) {
    if (mode == ColorMode::Yes)
      color_support = true;
    else if (mode == ColorMode::No)
      color_support = false;
    else
      color_support = has_color_support(file);
  }

  ~Sink() {
    if (do_close)
      fclose(file);
  }
};

struct Config {
  Sink sink{stderr};
  OutputFormat format = OutputFormat::text;
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

Sink make_sink() {
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

Config config;

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
  if (config.format == OutputFormat::text) {
    if (color == 0)
      fprintf(config.sink.file, "%-40s %.1f ms\n", name, instrmt_get_time_ms() - start);
    else
      fprintf(config.sink.file, "\e[0;%dm%-40s \e[1;34m%.1f\e[0m ms\n", color, name, instrmt_get_time_ms() - start);
  } else if (config.format == OutputFormat::csv) {
    fprintf(config.sink.file, "%.3f; %s; %.3f\n", start, name, instrmt_get_time_ms() - start);
  }
}

RegionContext::RegionContext(const char* name)
  : instrmt::RegionContext()
  , name(name)
  , color(config.sink.color_support ? instrmt_tty_string_color(name) : 0)
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
    , color(config.sink.color_support ? instrmt_tty_string_color(msg) : 0)
  {}

  void emit_message() const override {
    if (config.format == OutputFormat::text) {
      if (color == 0)
        fprintf(config.sink.file, "%s\n", msg);
      else
        fprintf(config.sink.file, "\e[0;%dm%-40s\e[0m\n", color, msg);
    } else if (config.format == OutputFormat::csv) {
      fprintf(config.sink.file, "%.3f; %s\n", instrmt_get_time_ms(), msg);
    }
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
  if (config.format == OutputFormat::text) {
    if (config.sink.color_support)
      fprintf(config.sink.file, "\e[0;%dm%s\e[0m\n", instrmt_tty_string_color(msg), msg);
    else
      fprintf(config.sink.file, "%s\n", msg);
  } else if (config.format == OutputFormat::csv) {
    fprintf(config.sink.file, "%.3f; %s\n", instrmt_get_time_ms(), msg);
  }
}

} // namespace tty
} // namespace instrmt

extern "C" {

instrmt::InstrmtEngine make_instrmt_engine() {
  using namespace std::string_literals;

  try {
    config.sink = make_sink();
  } catch (const std::exception& ex) {
    std::cerr << style::red_bg << "[INSTRMT/TTY] " << ex.what() << ", defaulting to " << config.sink.name << style::reset << std::endl;
  }

  try {
    config.format = parse_env<OutputFormat>(tty_format_env, OutputFormat::text);
  } catch (...) {
    std::cerr << style::red_bg << "[INSTRMT/TTY] Unsupported output format, defaulting to " << config.format << style::reset << std::endl;
  }

  if (config.format == OutputFormat::text) {
    ColorMode color_mode = ColorMode::Auto;
    try {
      color_mode = parse_env<ColorMode>(tty_color_env, ColorMode::Auto);
    } catch (...) {
      std::cerr << style::red_bg << "[INSTRMT/TTY] Unsupported color mode, defaulting to auto" << style::reset << std::endl;
    }
    config.sink.configure_color_support(color_mode);
  }

  std::cerr << style::green_fg << "[INSTRMT/TTY] out=" << config.sink.name << ", mode=" << config.sink.mode << ", format=" << config.format << ", color=" << std::boolalpha << config.sink.color_support << style::reset << std::endl;

  return {
    instrmt::tty::make_region_context,
    instrmt::tty::make_literal_message_context,
    instrmt::tty::instrmt_dynamic_message
  };
}

} // extern C
