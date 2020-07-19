#include <instrmt/instrmt.hxx>

void f() {
  INSTRMT_FUNCTION();
}

int main(int, char**) {
  f();
  return 0;
}
