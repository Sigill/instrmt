#!/bin/bash

function printf_n()
{
  local i
  for i in $(seq 1 $1) ; do
    printf "$2\n" $i
  done
}

{
  printf_n 1000 "void f%d();"
  printf_n 1000 "void lm%d();"
  printf_n 1000 "void m%d();"
} > instrmt-benchmarks-functions.hxx

{
  echo "#include <instrmt/instrmt.hxx>"
  printf_n 1000 "void f%d() { INSTRMT_FUNCTION(); }"
  printf_n 1000 "void lm%d() { INSTRMT_LITERAL_MESSAGE(__FUNCTION__); }"
  printf_n 1000 "void m%d() { INSTRMT_MESSAGE(__FUNCTION__); }"
} > instrmt-benchmarks-functions.cxx

{
  echo "void function1000();"
  echo "void lmessage1000();"
  echo "void message1000();"
} > instrmt-benchmarks-functions2.hxx

{
  echo "#include <instrmt-benchmarks-functions.hxx>"
  echo
  echo "void function1000() {"
  printf_n 1000 "  f%d();"
  echo "}"

  echo "void lmessage1000() {"
  printf_n 1000 "  lm%d();"
  echo "}"

  echo "void message1000() {"
  printf_n 1000 "  m%d();"
  echo "}"
} > instrmt-benchmarks-functions2.cxx
