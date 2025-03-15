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

#define INSTRMT_NAMED_LITERAL_MESSAGE(VAR, MSG) \
  static const std::unique_ptr<::instrmt::LiteralMessageContext> INSTRMTCONCAT(VAR, _instrmt_msg_ctx) = \
    ::instrmt::make_literal_message_context(MSG); \
  if (INSTRMTCONCAT(VAR, _instrmt_msg_ctx)) INSTRMTCONCAT(VAR, _instrmt_msg_ctx)->emit_message()

#define INSTRMT_LITERAL_MESSAGE(MSG) \
  INSTRMT_NAMED_LITERAL_MESSAGE(_, MSG)

#define INSTRMT_MESSAGE(MSG) \
  ::instrmt::emit_message(MSG)

#endif // INSTRMT_CXX_WRAPPER

#else // INSTRMT_DISABLE

#define INSTRMT_NAMED_REGION(VAR, NAME)

#define INSTRMT_NAMED_REGION_BEGIN(VAR, NAME)

#define INSTRMT_NAMED_REGION_END(VAR)

#define INSTRMT_REGION(NAME)

#define INSTRMT_REGION_BEGIN(NAME)

#define INSTRMT_REGION_END()

#define INSTRMT_FUNCTION()

#define INSTRMT_NAMED_LITERAL_MESSAGE(VAR, MSG)

#define INSTRMT_LITERAL_MESSAGE(MSG)

#define INSTRMT_MESSAGE(MSG)

#endif // INSTRMT_DISABLE

#endif // INSTRMT_HXX
