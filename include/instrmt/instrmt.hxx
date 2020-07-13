#ifndef INSTRMT_HXX
#define INSTRMT_HXX

#ifdef INSTRMT_ENABLE

#include <memory>

namespace instrmt {

class Region {
public:
  virtual ~Region() = default;
};

class RegionContext {
protected:
  virtual Region* make_region_ptr() { return nullptr; }

public:
  virtual ~RegionContext() = default;

  std::unique_ptr<Region> make_region();
};

typedef RegionContext* RegionContextFactory(const char* /*name*/,
                                            const char* /*function*/,
                                            const char* /*file*/,
                                            int /*line*/);

class MessageContext {
public:
  virtual ~MessageContext() = default;

  virtual void emit_message() const {}
};

typedef MessageContext* MessageContextFactory(const char* /*msg*/);

class Engine {
protected:
  void* handle = nullptr;
  RegionContextFactory* region_context_factory = nullptr;
  MessageContextFactory* message_context_factory = nullptr;

public:
  std::unique_ptr<RegionContext> make_region_context(const char* name,
                                                     const char* function,
                                                     const char* file,
                                                     int line) const;

  std::unique_ptr<MessageContext> make_message_context(const char* msg) const;
};

const Engine& engine();

} // namespace instrmt

#define INSTRMTCONCATIMPL(x,y) x##y
#define INSTRMTCONCAT(x,y) INSTRMTCONCATIMPL(x,y)

#define INSTRMT_NAMED_REGION(VAR, NAME) \
  static const std::unique_ptr<::instrmt::RegionContext> INSTRMTCONCAT(VAR, _instrmt_region_ctx) = \
    ::instrmt::engine().make_region_context(NAME, __FUNCTION__, __FILE__, __LINE__); \
  std::unique_ptr<::instrmt::Region> INSTRMTCONCAT(VAR, _instrmt_region) = INSTRMTCONCAT(VAR, _instrmt_region_ctx) ? INSTRMTCONCAT(VAR, _instrmt_region_ctx)->make_region() : nullptr

#define INSTRMT_NAMED_REGION_END(VAR) \
  INSTRMTCONCAT(VAR, _instrmt_region).reset()

#define INSTRMT_REGION(NAME) \
  INSTRMT_NAMED_REGION(_, NAME)

#define INSTRMT_REGION_END()\
  INSTRMT_NAMED_REGION_END(_)

#define INSTRMT_FUNCTION() \
  INSTRMT_NAMED_REGION(_, nullptr)

#define INSTRMT_NAMED_MESSAGE(VAR, MSG) \
  static const std::unique_ptr<::instrmt::MessageContext> INSTRMTCONCAT(VAR, _instrmt_msg_ctx) = \
    ::instrmt::engine().make_message_context(MSG); \
  if (INSTRMTCONCAT(VAR, _instrmt_msg_ctx)) INSTRMTCONCAT(VAR, _instrmt_msg_ctx)->emit_message()

#define INSTRMT_MESSAGE(MSG) \
  INSTRMT_NAMED_MESSAGE(_, MSG)

#else // INSTRMT_ENABLE

#define INSTRMT_NAMED_REGION(VAR, NAME)

#define INSTRMT_NAMED_REGION_END(VAR)

#define INSTRMT_REGION(NAME)

#define INSTRMT_REGION_END()

#define INSTRMT_FUNCTION(NAME)

#define INSTRMT_NAMED_MESSAGE(VAR, MSG)

#define INSTRMT_MESSAGE(MSG)

#endif // INSTRMT_ENABLE

#endif // INSTRMT_HXX
