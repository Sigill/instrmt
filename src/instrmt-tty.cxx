#include "instrmt/instrmt.hxx"

#include <stdio.h>
#include <sys/time.h>
#include <string>

namespace {

inline double get_time_ms_ms() {
  struct timeval time_s;
  gettimeofday(&time_s, 0);
  return time_s.tv_sec * 1000.0 + (time_s.tv_usec / 1000.0);
}

inline int string_color(const char* p) {
  constexpr int num_colors = 14;
  static const int colors[num_colors] = {
    31, // red
    32, // green
    33, // yellow
    34, // blue
    35, // magenta
    36, // cyan
    37, // light gray
    90, // dark gray
    91, // light red
    92, // light green
    93, // light yellow
    94, // light blue
    95, // light magenta
    96  // light cyan
  };

  size_t result = 0;
  const size_t prime = 31;
  while(*p != 0)
  result = *p++ + (result * prime);
  return colors[result % num_colors];
}

//inline void print_now(const char* name, bool start) {
//  struct timeval tv;
//  gettimeofday(&tv, 0);
//  struct tm lt;
//  localtime_r(&tv.tv_sec, &lt);

//  char buf[64];
//  ssize_t written = (ssize_t)strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &lt);
//  snprintf(buf+written, sizeof(buf)-(size_t)written, ".%06ld", tv.tv_usec);

//  int color = string_color(name);

//  if (start)
//    printf("\e[0;%dm%-40s\e[0m Start \e[1;34m%s\e[0m\n", color, name, buf);
//  else
//    printf("\e[0;%dm%-40s\e[0m Stop  \e[1;34m%s\e[0m\n", color, name, buf);
//}

} // anonymous namespace

namespace instrmt {
namespace tty {

class Region : public instrmt::Region {
private:
  const char* name;
  double start;
  int color;
  bool live = true;

public:
  explicit Region(const char* name);
  ~Region();
};

class RegionContext : public instrmt::RegionContext {
private:
  const char* name;

public:
  explicit RegionContext(const char* name);

  Region* make_region_ptr() override;
};

class MessageContext : public instrmt::MessageContext {
private:
  const char* msg;
  int color;

public:
  explicit MessageContext(const char* msg);

  void emit_message() const override;
};

Region::Region(const char* name)
  : instrmt::Region()
  , name(name)
  , start(get_time_ms_ms())
  , color(string_color(name))
{}

Region::~Region()
{
  if (live) {
    live = false;
    printf("\e[0;%dm%-40s \e[1;34m%.1f\e[0m ms\n", color, name,  get_time_ms_ms() - start);
  }
}

RegionContext::RegionContext(const char* name)
  : instrmt::RegionContext()
  , name(name)
{}

Region*RegionContext::make_region_ptr()
{
  return new Region(name);
}

MessageContext::MessageContext(const char* msg)
  : instrmt::MessageContext ()
  , msg(msg)
  , color(string_color(msg))
{}

void MessageContext::emit_message() const {
  printf("\e[0;%dm%-40s\e[0m\n", color, msg);
}

extern "C" {

::instrmt::RegionContext* make_region_context(const char* name,
                                              const char* function,
                                              const char* /*file*/,
                                              int /*line*/)
{
  return new instrmt::tty::RegionContext(name ? name : function);
}

::instrmt::MessageContext* make_message_context(const char* msg)
{
  return new instrmt::tty::MessageContext(msg);
}

} // extern C

} // namespace tty
} // namespace instrmt
