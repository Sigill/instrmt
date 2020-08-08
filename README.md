# Instrmt

Instrmt is a C++ library providing a common API to multiple instrumentation/tracing/telemetry tools.

It currently supports three "instrumentation engines":

- _tty_: basic engine printing instrumentation results to the console.
- _itt_: [Intel ITT API](https://software.intel.com/content/www/us/en/develop/articles/intel-itt-api-open-source.html), for VTune or [Intel SEAPI](https://github.com/intel/IntelSEAPI).
- _tracy_: [Tracy profiler](https://github.com/wolfpld/tracy).

## Region markup

The following macros (defined in `instrmt/instrmt.hxx`) let you markup the start and end of a block of code to instrument.

Regions are similar to Intel's *Tasks* or Tracy's *Zones*.

The following macros use RAII to bind end of of a region to the scope of the underlying variables.

- `INSTRMT_FUNCTION()`: instrument the current scope, using the name of the function.

- `INSTRMT_REGION(NAME)`: instrument the current scope, using a custom name.

- `INSTRMT_NAMED_REGION(VAR, NAME)`: same as `INSTRMT_REGION`, but uses `VAR` as a prefix to prevent conflicts in the underlying variables.

If you cannot relies on RAII, use the following macros to manually markup the start and end of a region.

- `INSTRMT_REGION_BEGIN()`, `INSTRMT_REGION_END()`

- `INSTRMT_NAMED_REGION_BEGIN(VAR)`, `INSTRMT_NAMED_REGION_END(VAR)`

For performance reasons, `NAME` must be a string literal.

## Usage

### Dynamic wrapper

The *instrmt* library provides a mechanism to dynamically load a an instrumentation engine at runtime.

To do that, include `instrmt/instrmt.hxx`, markup your code, and link against the `instrmt` library.

At runtime, specify the engine to use using the `INSTRMT_ENGINE` environment variable. When undefined, the overhead should be minimal.

Instrmt API can be disabled at compile time (rendering the macros no-op, and linking to `libinstrmt` not required) by defining the `INSTRMT_DISABLE` compilation option.

#### Example

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
$ g++ main.cpp -I/path/to/instrmt/include -L/path/to/instrmt/lib -linstrmt -ldl -o main

$ ./main
# No instrumentation

$ INSTRMT_ENGINE=/path/to/instrmt/lib/libinstrmt-tty.so ./main
f                                0.0ms
```

### Static wrapper

If the dynamic wrapper has too much overhead, Instrmt can be used as a simple wrapper, providing just a common API above other instrumentation libraries.

Wrappers for the _tty_, _itt_ & _tracy_ engines are provided.

To use a wrapper:

- Include `instrmt/instrmt.hxx` and markup your code.
- Make sure your compiler can locate that include.
- Import the underlying library as usual (Instrmt is just a wrapper, your compiler needs to find its includes and link against it).

See the `use_*_wrapper()` macros in `cmake/instrmt.cmake` for examples on how to do it with CMake.

## License

This project is released under the terms of the MIT License. See the LICENSE.txt file for more details.
