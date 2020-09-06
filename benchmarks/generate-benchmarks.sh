#!/bin/bash

rm -f instrmt-benchmarks-functions.hxx instrmt-benchmarks-functions.cxx
rm -f instrmt-benchmarks-functions2.hxx instrmt-benchmarks-functions2.cxx

echo "#include <instrmt/instrmt.hxx>" > instrmt-benchmarks-functions.cxx

echo "void instrmt1000();" >> instrmt-benchmarks-functions2.hxx

cat >> instrmt-benchmarks-functions2.cxx <<EOL
#include <instrmt-benchmarks-functions.hxx>

void instrmt1000() {
EOL

for i in {1..1000} ; do
  echo "void f$i();" >> instrmt-benchmarks-functions.hxx

  cat >> instrmt-benchmarks-functions.cxx <<EOL
void f$i() { INSTRMT_FUNCTION(); }
EOL

  echo "  f$i();" >> instrmt-benchmarks-functions2.cxx
done

echo "}" >> instrmt-benchmarks-functions2.cxx
