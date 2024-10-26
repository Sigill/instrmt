#include <instrmt/details/base.hxx>
#include <instrmt/details/engine.hxx>

#ifndef TRACY_ENABLE
#define TRACY_ENABLE
#endif

#include <tracy/TracyC.h>
#include <cstring>

namespace instrmt {
namespace tracy {

class Region : public instrmt::Region {
private:
  TracyCZoneCtx tracyctx;

public:
  explicit Region(const struct ___tracy_source_location_data* srcloc);

  ~Region();
};

class RegionContext : public instrmt::RegionContext {
private:
  struct ___tracy_source_location_data sourceloc;

public:
  RegionContext(const char* name, const char *function, const char *file, int line);

  Region* make_region_ptr() override {
    return new instrmt::tracy::Region(&sourceloc);
  };
};

Region::Region(const struct ___tracy_source_location_data* srcloc)
  : ::instrmt::Region()
  , tracyctx(___tracy_emit_zone_begin(srcloc, true))
{}

Region::~Region() {
  ___tracy_emit_zone_end(tracyctx);
}

RegionContext::RegionContext(const char *name, const char *function, const char *file, int line)
  : ::instrmt::RegionContext()
  , sourceloc{name, function, file, (uint32_t)line, 0}
{}

class LiteralMessageContext : public instrmt::LiteralMessageContext {
private:
  const char* msg;

public:
  explicit LiteralMessageContext(const char* msg)
    : instrmt::LiteralMessageContext ()
    , msg(msg)
  {}

  void emit_message() const override {
    ___tracy_emit_messageL(msg, 0);
  }
};

instrmt::RegionContext* make_region_context(const char* name,
                                            const char *function,
                                            const char *file,
                                            int line)
{
  return new instrmt::tracy::RegionContext(name, function, file, line);
}

::instrmt::LiteralMessageContext* make_literal_message_context(const char* msg)
{
  return new instrmt::tracy::LiteralMessageContext(msg);
}

void instrmt_dynamic_message(const char* msg)
{
  ___tracy_emit_message(msg, strlen(msg), 0);
}

} // namespace tracy
} // namespace instrmt

extern "C" {

instrmt::InstrmtEngine make_instrmt_engine() {
  return {
    instrmt::tracy::make_region_context,
    instrmt::tracy::make_literal_message_context,
    instrmt::tracy::instrmt_dynamic_message
  };
}

} // extern C
