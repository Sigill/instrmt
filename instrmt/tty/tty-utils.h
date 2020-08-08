#ifndef INSTRMTTTYUTILS_H
#define INSTRMTTTYUTILS_H

#include <sys/time.h>

inline double instrmt_get_time_ms() {
  struct timeval time_s;
  gettimeofday(&time_s, 0);
  return time_s.tv_sec * 1000.0 + (time_s.tv_usec / 1000.0);
}

inline int instrmt_tty_string_color(const char* p) {
  constexpr int num_colors = 14;
  static const int colors[num_colors] = {
    31, // red
    32, // green
    33, // yellow
    34, // blue
    35, // magenta
    36, // cyan
    37, // light gray
    90, // dark gray
    91, // light red
    92, // light green
    93, // light yellow
    94, // light blue
    95, // light magenta
    96  // light cyan
  };

  unsigned long result = 0;
  const unsigned long prime = 31;
  while(*p != 0)
    result = *p++ + (result * prime);
  return colors[result % num_colors];
}

#endif // INSTRMTTTYUTILS_H
