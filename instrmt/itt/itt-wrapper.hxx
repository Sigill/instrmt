#ifndef INSTRMTITTWRAPPER_HXX
#define INSTRMTITTWRAPPER_HXX

#include <instrmt/details/utils.h>

#include <ittnotify.h>

static const __itt_domain* __itt_domain_name = __itt_domain_create("instrmt");

class ITTTask
{
private:
  bool live = true;

public:
  inline explicit ITTTask(__itt_string_handle* pName) {
    __itt_task_begin(__itt_domain_name, __itt_null, __itt_null, pName);
  }

  inline void terminate() {
    if (live) {
      live = false;
      __itt_task_end(__itt_domain_name);
    }
  }

  inline ~ITTTask() {
    terminate();
  }
};

#define INSTRMT_NAMED_REGION(VAR, NAME) \
  static __itt_string_handle* INSTRMTCONCAT(VAR, _itt_region_name) = __itt_string_handle_create(NAME); \
  ITTTask INSTRMTCONCAT(VAR, _itt_region) ( INSTRMTCONCAT(VAR, _itt_region_name) )

#define INSTRMT_NAMED_REGION_BEGIN(VAR, NAME) INSTRMT_NAMED_REGION(VAR, NAME)

#define INSTRMT_NAMED_REGION_END(VAR) INSTRMTCONCAT(VAR, _itt_region).terminate()

#define INSTRMT_REGION(NAME) INSTRMT_NAMED_REGION(_, NAME)

#define INSTRMT_REGION_BEGIN(NAME) INSTRMT_NAMED_REGION(_, NAME)

#define INSTRMT_REGION_END() INSTRMT_NAMED_REGION_END(_)

#define INSTRMT_FUNCTION() INSTRMT_NAMED_REGION(_, __FUNCTION__)

#endif // INSTRMTITTWRAPPER_HXX
