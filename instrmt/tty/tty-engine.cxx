#include <instrmt/details/base.hxx>

#include <stdio.h>
#include <string>
#include <atomic>

#include <instrmt/tty/tty-utils.h>

namespace {

typedef struct {
  const char* name;
  int color;
} TTYCRegionContext;

TTYCRegionContext contexts[1000];

typedef struct {
  TTYCRegionContext* ctx;
  double start;
} TTYCRegion;

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

void* make_c_region_context(const char* name,
                            const char* function,
                            const char* /*file*/,
                            int /*line*/)
{
  static std::atomic<unsigned long> current_context(0);

  TTYCRegionContext& ctx = contexts[current_context++];
  ctx.name = name ? name : function;
  ctx.color = instrmt_tty_string_color(ctx.name);

  return &ctx;
}

void* begin_region(void* context) {
  TTYCRegion* r = new TTYCRegion;
  r->ctx = reinterpret_cast<TTYCRegionContext*>(context);
  r->start = instrmt_get_time_ms();
  return r;
}

void end_region(void* region) {
  TTYCRegion* r = reinterpret_cast<TTYCRegion*>(region);
  printf("\e[0;%dm%-40s \e[1;34m%.1f\e[0m ms\n", r->ctx->color, r->ctx->name,  instrmt_get_time_ms() - r->start);
  delete r;
}

} // extern C
