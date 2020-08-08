#include <instrmt/instrmt.hxx>

void f() {
  {
    INSTRMT_REGION("f1");

    INSTRMT_NAMED_REGION(f2, "f2");
  }

  INSTRMT_REGION_BEGIN("f3");

  INSTRMT_NAMED_REGION_BEGIN(f4, "f4");

  INSTRMT_NAMED_REGION_END(f4);

  INSTRMT_REGION_END();
}

int main(int, char**) {
  INSTRMT_FUNCTION();
  f();
  return 0;
}
