#ifndef INSTRMT_UTILS_HXX
#define INSTRMT_UTILS_HXX

#include <ostream>

namespace instrmt {
namespace ansi {

enum class style : unsigned char {
       reset = 0,
        bold = 1,
        dark = 2,
   underline = 4,
       blink = 5,
     reverse = 7,
   concealed = 8,
     crossed = 9,

     grey_fg = 30,
      red_fg = 31,
    green_fg = 32,
   yellow_fg = 33,
     blue_fg = 34,
  magenta_fg = 35,
     cyan_fg = 36,
    white_fg = 37,
  default_fg = 39,

     grey_bg = 40,
      red_bg = 41,
    green_bg = 42,
   yellow_bg = 43,
     blue_bg = 44,
  magenta_bg = 45,
     cyan_bg = 46,
    white_bg = 47,
  default_bg = 49
};

bool is_atty(const std::ostream& stream);

bool enabled(std::ostream& stream);

std::ostream& enable(std::ostream& stream);

std::ostream& disable(std::ostream& stream);

const char* escape_sequence(style st);

std::ostream& operator<<(std::ostream& os, style st);

} // namespace ansi
} // namespace instrmt

#endif // INSTRMT_UTILS_HXX
