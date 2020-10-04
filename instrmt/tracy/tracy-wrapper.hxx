#ifndef INSTRMTTRACYWRAPPER_HXX
#define INSTRMTTRACYWRAPPER_HXX

#include <TracyC.h>

#include <cstring>

class InstrmtTracyRegion {
private:
  TracyCZoneCtx tracyctx;
  bool live = true;

public:
  explicit InstrmtTracyRegion(const struct ___tracy_source_location_data* srcloc)
    : tracyctx(___tracy_emit_zone_begin(srcloc, true))
  {}

  void terminate() {
    if (live) {
      live = false;
      ___tracy_emit_zone_end(tracyctx);
    }
  }

  ~InstrmtTracyRegion() {
    terminate();
  }
};

inline void instrmt_tracy_emit_message(const char* msg)
{
  ___tracy_emit_message(msg, strlen(msg), 0);
}

#define INSTRMT_NAMED_REGION(VAR, NAME) \
  static const struct ___tracy_source_location_data TracyConcat(VAR, _tracy_source_location) = { NAME, __FUNCTION__,  __FILE__, (uint32_t)__LINE__, 0 }; \
  InstrmtTracyRegion TracyConcat(VAR, _tracy_region)(&TracyConcat(VAR, _tracy_source_location))

#define INSTRMT_NAMED_REGION_BEGIN(VAR, NAME) INSTRMT_NAMED_REGION(VAR, NAME)

#define INSTRMT_NAMED_REGION_END(VAR) TracyConcat(VAR, _tracy_region).terminate()

#define INSTRMT_REGION(NAME) INSTRMT_NAMED_REGION(_, NAME)

#define INSTRMT_REGION_BEGIN(NAME) INSTRMT_NAMED_REGION(_, NAME)

#define INSTRMT_REGION_END() INSTRMT_NAMED_REGION_END(_)

#define INSTRMT_FUNCTION() INSTRMT_NAMED_REGION(_, (char*)0)

#define INSTRMT_NAMED_LITERAL_MESSAGE(VAR, MSG) \
  ___tracy_emit_messageL(MSG, 0);

#define INSTRMT_LITERAL_MESSAGE(MSG) \
  INSTRMT_NAMED_LITERAL_MESSAGE(_, MSG)

#define INSTRMT_MESSAGE(MSG) \
  instrmt_tracy_emit_message(MSG);

#endif // INSTRMTTRACYWRAPPER_HXX
