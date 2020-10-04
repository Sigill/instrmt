#ifndef INSTRMTDYNAMIC_HXX
#define INSTRMTDYNAMIC_HXX

#include <instrmt/details/base.hxx>

namespace instrmt {

std::unique_ptr<RegionContext> make_region_context(const char* name,
                                                   const char* function,
                                                   const char* file,
                                                   int line);

std::unique_ptr<LiteralMessageContext> make_literal_message_context(const char* msg);

void emit_message(const char* msg);

} // namespace instrmt

#endif // INSTRMTDYNAMIC_HXX
