#ifndef INSTRMTTTYWRAPPER_HXX
#define INSTRMTTTYWRAPPER_HXX

#include <instrmt/tty/tty-utils.h>
#include <instrmt/details/utils.h>

#include <stdio.h>

struct InstrmtTTYRegionContext {
  const char* name;
  int color;
};

class InstrmtTTYRegion
{
private:
  const struct InstrmtTTYRegionContext& ctx;
  double start;
  bool live = true;

public:
  explicit inline InstrmtTTYRegion(const struct InstrmtTTYRegionContext& ctx)
    : ctx(ctx)
    , start(instrmt_get_time_ms())
  {}

  inline void terminate() {
    if (live) {
      live = false;
      fprintf(stderr, "\e[0;%dm%-40s \e[1;34m%.1f\e[0m ms\n", ctx.color, ctx.name, instrmt_get_time_ms() - start);
    }
  }

  inline ~InstrmtTTYRegion() {
    terminate();
  }
};

class InstrmtTTYLiteralMessageContext {
private:
  const char* msg;
  int color;

public:
  explicit InstrmtTTYLiteralMessageContext(const char* msg)
    : msg(msg)
    , color(instrmt_tty_string_color(msg))
  {}

  void emit_message() const {
    fprintf(stderr, "\e[0;%dm%-40s\e[0m\n", color, msg);
  }
};

inline void instrmt_tty_emit_message(const char* msg)
{
  fprintf(stderr, "\e[0;%dm%-40s\e[0m\n", instrmt_tty_string_color(msg), msg);
}

#define INSTRMT_NAMED_REGION(VAR, NAME) \
  static const struct InstrmtTTYRegionContext INSTRMTCONCAT(VAR, _instrmt_tty_region_ctx) = {NAME, instrmt_tty_string_color(NAME)}; \
  InstrmtTTYRegion INSTRMTCONCAT(VAR, _instrmt_tty_region)(INSTRMTCONCAT(VAR, _instrmt_tty_region_ctx))

#define INSTRMT_NAMED_REGION_BEGIN(VAR, NAME) INSTRMT_NAMED_REGION(VAR, NAME)

#define INSTRMT_NAMED_REGION_END(VAR) INSTRMTCONCAT(VAR, _instrmt_tty_region).terminate()

#define INSTRMT_REGION(NAME) INSTRMT_NAMED_REGION(_, NAME)

#define INSTRMT_REGION_BEGIN(NAME) INSTRMT_NAMED_REGION(_, NAME)

#define INSTRMT_REGION_END() INSTRMT_NAMED_REGION_END(_)

#define INSTRMT_FUNCTION() INSTRMT_NAMED_REGION(_, __FUNCTION__)

#define INSTRMT_NAMED_LITERAL_MESSAGE(VAR, MSG) \
  static const InstrmtTTYLiteralMessageContext INSTRMTCONCAT(VAR, _instrmt_msg_ctx)(MSG); \
  INSTRMTCONCAT(VAR, _instrmt_msg_ctx).emit_message()

#define INSTRMT_LITERAL_MESSAGE(MSG) \
  INSTRMT_NAMED_LITERAL_MESSAGE(_, MSG)

#define INSTRMT_MESSAGE(MSG) \
  instrmt_tty_emit_message(MSG)

#endif // INSTRMTTTYWRAPPER_HXX
