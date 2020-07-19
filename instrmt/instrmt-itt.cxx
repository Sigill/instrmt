#include "instrmt/instrmt.hxx"

#include <ittnotify.h>

namespace {
static __itt_domain* instrmt_domain = __itt_domain_create("instrmt");
}

namespace instrmt {
namespace itt {

class Region : public instrmt::Region {
protected:
  bool live = true;

  __itt_string_handle *name;
  __itt_id m_id = __itt_null;

public:
  explicit Region(__itt_string_handle* pName);

  ~Region();
};

class RegionContext : public instrmt::RegionContext {
private:
  __itt_string_handle *string_handle;

public:
  explicit RegionContext(const char* name);

  Region* make_region_ptr() override {
    return new instrmt::itt::Region(string_handle);
  };
};

RegionContext::RegionContext(const char *name)
: ::instrmt::RegionContext()
, string_handle(__itt_string_handle_create(name))
{}

Region::Region(__itt_string_handle *pName)
: name(pName)
, m_id(__itt_id_make(instrmt_domain, reinterpret_cast<unsigned long long>(pName)))
{
  __itt_task_begin(instrmt_domain, m_id, __itt_null, pName);
}

Region::~Region()
{
  if (live) {
    __itt_task_end(instrmt_domain);
    live = false;
  }
}

} // namespace itt
} // namespace instrmt

extern "C" {

instrmt::RegionContext* make_region_context(const char* name,
                                      const char *function,
                                      const char */*file*/,
                                      int /*line*/)
{
  return new instrmt::itt::RegionContext(name ? name : function);
}

} // extern C
