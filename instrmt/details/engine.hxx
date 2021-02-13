#ifndef INSTRMTDYNAMIC_HXX
#define INSTRMTDYNAMIC_HXX

#include <instrmt/details/base.hxx>

namespace instrmt {

typedef RegionContext* RegionContextFactory(const char* /*name*/,
                                            const char* /*function*/,
                                            const char* /*file*/,
                                            int /*line*/);

typedef LiteralMessageContext* LiteralMessageContextFactory(const char* /*msg*/);

typedef void DynamicMessageSender(const char* /*msg*/);

struct InstrmtEngine {
  RegionContextFactory* region_context_factory;
  LiteralMessageContextFactory* literal_message_context_factory;
  DynamicMessageSender* dynamic_message_sender;
};

} // namespace instrmt

namespace instrmt {

std::unique_ptr<RegionContext> make_region_context(const char* name,
                                                   const char* function,
                                                   const char* file,
                                                   int line);

std::unique_ptr<LiteralMessageContext> make_literal_message_context(const char* msg);

void emit_message(const char* msg);

} // namespace instrmt

#endif // INSTRMTDYNAMIC_HXX
