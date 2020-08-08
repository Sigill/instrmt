#ifndef INSTRMTCORE_HXX
#define INSTRMTCORE_HXX

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

  std::unique_ptr<Region> make_region()
  {
    return std::unique_ptr<Region>(make_region_ptr());
  }
};

} // namespace instrmt

#endif // INSTRMTCORE_HXX
