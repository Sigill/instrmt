#ifndef INSTRMT_HXX
#define INSTRMT_HXX

#ifndef INSTRMT_DISABLE

#ifdef INSTRMT_CXX_WRAPPER
#include INSTRMT_CXX_WRAPPER
#else

#include <instrmt/details/engine.hxx>
#include <instrmt/details/utils.h>

#define INSTRMT_NAMED_REGION(VAR, NAME) \
  static const std::unique_ptr<::instrmt::RegionContext> INSTRMTCONCAT(VAR, _instrmt_region_ctx) = \
    ::instrmt::make_region_context(NAME, __FUNCTION__, __FILE__, __LINE__); \
  std::unique_ptr<::instrmt::Region> INSTRMTCONCAT(VAR, _instrmt_region) = INSTRMTCONCAT(VAR, _instrmt_region_ctx) ? INSTRMTCONCAT(VAR, _instrmt_region_ctx)->make_region() : nullptr

#define INSTRMT_NAMED_REGION_BEGIN(VAR, NAME) \
  INSTRMT_NAMED_REGION(VAR, NAME)

#define INSTRMT_NAMED_REGION_END(VAR) \
  INSTRMTCONCAT(VAR, _instrmt_region).reset()

#define INSTRMT_REGION(NAME) \
  INSTRMT_NAMED_REGION(_, NAME)

#define INSTRMT_REGION_BEGIN(NAME) \
  INSTRMT_NAMED_REGION(_, NAME)

#define INSTRMT_REGION_END()\
  INSTRMT_NAMED_REGION_END(_)

#define INSTRMT_FUNCTION() \
  INSTRMT_NAMED_REGION(_, nullptr)

#endif // INSTRMT_CXX_WRAPPER

#else // INSTRMT_DISABLE

#define INSTRMT_NAMED_REGION(VAR, NAME)

#define INSTRMT_NAMED_REGION_END(VAR)

#define INSTRMT_REGION(NAME)

#define INSTRMT_REGION_END()

#define INSTRMT_FUNCTION()

#endif // INSTRMT_DISABLE

#endif // INSTRMT_HXX
