#include "instrmt/instrmt.hxx"

#define TRACY_ENABLE
#include <TracyC.h>

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

class MessageContext : public instrmt::MessageContext {
private:
  const char* msg;

public:
  explicit MessageContext(const char* msg);

  void emit_message() const override;
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

MessageContext::MessageContext(const char* msg)
  : instrmt::MessageContext ()
  , msg(msg)
{}

void MessageContext::emit_message() const {
  ___tracy_emit_messageL(msg, 0);
}

} // namespace tracy
} // namespace telemetry

extern "C" {

instrmt::RegionContext* make_region_context(const char* name,
                                        const char *function,
                                        const char *file,
                                        int line)
{
  return new instrmt::tracy::RegionContext(name, function, file, line);
}

::instrmt::MessageContext* make_message_context(const char* msg)
{
  return new instrmt::tracy::MessageContext(msg);
}

} // extern C
