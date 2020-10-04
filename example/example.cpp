#include <instrmt/instrmt.hxx>

#include <thread>
#include <chrono>

using namespace std::chrono_literals;

void f() {
  {
    INSTRMT_REGION("f1");

    std::this_thread::sleep_for(10ms);

    INSTRMT_NAMED_REGION(f2, "f2");

    std::this_thread::sleep_for(10ms);
  }

  INSTRMT_REGION_BEGIN("f3");

  std::this_thread::sleep_for(10ms);

  INSTRMT_NAMED_REGION_BEGIN(f4, "f4");

  std::this_thread::sleep_for(10ms);

  INSTRMT_NAMED_REGION_END(f4);

  INSTRMT_REGION_END();
}

int main(int, char**) {
  INSTRMT_FUNCTION();

  INSTRMT_LITERAL_MESSAGE("First call");
  f();

  std::string m = "Second call";
  INSTRMT_MESSAGE(m.c_str());
  f();
  return 0;
}
