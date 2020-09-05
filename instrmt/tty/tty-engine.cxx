#include <instrmt/details/base.hxx>

#include <stdio.h>
#include <string>
#include <atomic>

#include <instrmt/tty/tty-utils.h>

namespace instrmt {
namespace tty {

class Region : public instrmt::Region {
private:
  const char* name;
  double start;
  int color;
  bool live = true;

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
  if (live) {
    live = false;
    printf("\e[0;%dm%-40s \e[1;34m%.1f\e[0m ms\n", color, name, instrmt_get_time_ms() - start);
  }
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

} // namespace tty
} // namespace instrmt


extern "C" {

::instrmt::RegionContext* make_region_context(const char* name,
                                              const char* function,
                                              const char* /*file*/,
                                              int /*line*/)
{
  return new instrmt::tty::RegionContext(name ? name : function);
}

} // extern C
