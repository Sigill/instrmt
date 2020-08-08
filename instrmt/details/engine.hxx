#ifndef INSTRMTDYNAMIC_HXX
#define INSTRMTDYNAMIC_HXX

#include <instrmt/details/base.hxx>

namespace instrmt {

std::unique_ptr<RegionContext> make_region_context(const char* name,
                                                   const char* function,
                                                   const char* file,
                                                   int line);

} // namespace instrmt

#endif // INSTRMTDYNAMIC_HXX
