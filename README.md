# Instrmt

Instrmt is a C++ library providing a common API to multiple instrumentation/tracing/telemetry tools.

It currently supports three "instrumentation engines":

- _tty_: basic engine printing instrumentation results to the console.
- _itt_: [Intel ITT API](https://software.intel.com/content/www/us/en/develop/articles/intel-itt-api-open-source.html), for VTune or [Intel SEAPI](https://github.com/intel/IntelSEAPI).
- _tracy_: [Tracy profiler](https://github.com/wolfpld/tracy).

## API

All of Instrmt C++ API is defined by macros in `instrmt/instrmt.hxx`.

### Region markup

A region define the start and end of a block of code (regions are similar to Intel's *Tasks* or Tracy's *Zones*).

The following macros use RAII to bind the end of a region to the scope of the underlying variables.

- `INSTRMT_FUNCTION()`: instrument the current scope, using the name of the function.
- `INSTRMT_REGION(NAME)`: instrument the current scope, using a custom name.
- `INSTRMT_NAMED_REGION(VAR, NAME)`: same as `INSTRMT_REGION`, but uses `VAR` as a prefix to prevent conflicts in the underlying variables.

If you cannot rely on RAII, use the following macros to manually markup the start and end of a region.

- `INSTRMT_REGION_BEGIN(NAME)`, `INSTRMT_REGION_END()`
- `INSTRMT_NAMED_REGION_BEGIN(VAR, NAME)`, `INSTRMT_NAMED_REGION_END(VAR)`

For performance reasons, `NAME` must be a string literal.

### Messages

Messages allow you to log arbitrary events to help you navigate through a program's trace.

The following macros are available:

- `INSTRMT_LITERAL_MESSAGE(MSG)`, `INSTRMT_NAMED_LITERAL_MESSAGE(VAR, MSG)` for string literals.
- `INSTRMT_MESSAGE(MSG)` for arbitrary strings.

Note: Despite having an API for messages, VTune does not support them.

## Usage

### Dynamic wrapper

The *instrmt* library provides a mechanism to dynamically load an instrumentation engine at runtime.

To do that, include `instrmt/instrmt.hxx`, markup your code, and link against the `instrmt` library.

At runtime, specify the engine to load using the `INSTRMT_ENGINE` environment variable. When undefined, the overhead should be minimal.

Instrmt API can be disabled at compile time (rendering the macros no-op, and linking to the `instrmt` library not required) by defining the `INSTRMT_DISABLE` compilation option.

#### Available engines

- `libinstrmt-tty.so`

  Available options
  - `INSTRMT_TTY_OUT=stderr|stdout|<a file>`: Specify where to print the output.
    When outputing to a file, if `%date%` is found in the filename, it will be replaced by the current date.
  - `INSTRMT_TTY_TRUNCATE_OUT`: Cause the output file to be truncated before writing to it.
  - `INSTRMT_TTY_COLOR=auto|yes|no`: Enable/disable colored output (default: auto).
  - `INSTRMT_TTY_FORMAT=text|csv`: Specify the output format.
- `libinstrmt-itt.so`
- `libinstrmt-tracy.so`

#### Example

```cpp
// main.cpp
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

```sh
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
- Add the following define: `INSTRMT_CXX_WRAPPER=\"instrmt/*/*-wrapper.hxx\"`.
- Import the underlying library as usual (Instrmt is just a wrapper, your compiler needs to find its includes and link against it).

e.g.:

`g++ main.cpp -I/path/to/instrmt/include -I/path/to/ittnotify/include -DINSTRMT_CXX_WRAPPER=\"instrmt/itt/itt-wrapper.hxx\" -L/path/to/ittnotify/lib littnotify -lpthread -ldl -o main`

See the `use_*_wrapper()` macros in `cmake/instrmt.cmake` for examples using CMake.

## License

This project is released under the terms of the MIT License. See the LICENSE.txt file for more details.
