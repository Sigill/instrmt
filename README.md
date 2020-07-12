# Instrmt

Instrmt is a library providing an API abstracting multiple instrumentation/tracing/telemetry tools.

It currently supports three "instrumentation engines":

- _tty_: basic engine printing instrumentation results to the console.
- _itt_: [Intel ITT API](https://software.intel.com/content/www/us/en/develop/articles/intel-itt-api-open-source.html).
- _tracy_: [Tracy profiler](https://github.com/wolfpld/tracy).

## Usage

Instrmt API is disabled by default (the macros are no-op, linking to `libinstrmt` is not required).

It is enabled by defining the `INSTRMT_ENABLE` compilation option.

The instrumentation engine to use must be specified by the `INSTRMT_ENGINE` environment variable. When undefined, the overhead should be minimal.

### C++ API

These macros are used to define a region of code to instrument.

They rely on RAII to automatically detect the end of the region.

If you cannot relies on RAII, use the `*_END` macros to manually trigger the end of a region.

`INSTRMT_FUNCTION()`: instrument the current scope, using the name of the function.

`INSTRMT_REGION(NAME)`, `INSTRMT_NAMED_REGION(VAR, NAME)`: instrument the region scope, using a custom name.

`INSTRMT_REGION_END()`, `INSTRMT_NAMED_REGION_END(VAR)`: terminate the current region.

The `NAMED` versions use `VAR` as a prefix for the underlying variables.

For performance reasons, `NAME` must be a string literal.

### Example

```
#include <instrmt/instrmt.hxx>

void f() {
    INSTRMT_FUNCTION();
    // ...
}

int main(int, char**) {
    f();
    return 0;
}
```

```
$ g++ main.cpp -DINSTRMT_ENABLE -I/path/to/instrmt/include -L/path/to/instrmt/lib -linstrmt -ldl -o main

$ ./main
# No instrumentation

$ INSTRMT_ENGINE=/path/to/instrmt/lib/libinstrmt-tty.so ./main
f                                0.0ms
```

## License

This project is released under the terms of the MIT License. See the LICENSE.txt file for more details.
