# Instrmt

**Instrmt** is a C++ library that provides a common API to multiple instrumentation/tracing/telemetry ecosystems.

It especially supports with:

- **itt**: Intel's [Instrumentation and Tracing Technology API (ITT API)](https://github.com/intel/ittapi).\
  Used by [VTune](https://www.intel.com/content/www/us/en/docs/vtune-profiler/user-guide/2025-0/instrumentation-and-tracing-technology-apis.html) and [Intel SEAPI](https://github.com/intel/IntelSEAPI) (discontinued).
- **tracy**: [Tracy profiler](https://github.com/wolfpld/tracy).

## Quick start

```cmake
# CMakeLists.txt
cmake_minimum_required(VERSION 3.14)
project(my_project)

find_package(Instrmt)
add_executable(app main.cpp)
target_link_libraries(app PRIVATE instrmt)
```

```cpp
// main.cpp
#include <instrmt/instrmt.hxx>

int main(int, char**) {
  INSTRMT_FUNCTION();
  // ...
  return 0;
}
```

```sh
$ cmake -S . -B build/ -DInstrmt_DIR=
$ cmake --build build/
$ INSTRMT_ENGINE=/path/to/instrmt/lib/libinstrmt-tty.so ./build/app
main                                     0.1 ms
```

## Instrumentation API

All of the public Instrmt C++ API is defined by macros in `instrmt/instrmt.hxx`.

### Region markup

A region define the start and end of a block of code (regions are similar to Intel's _Tasks_ or Tracy's _Zones_).

The following macros use RAII to bind the end of a region to the scope of the underlying variable.

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

### Example

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

## Usage

**Instrmt** gives access to the various ecosystems through _instrumentation engines_.

### Dynamic wrapper

The `instrmt` library provides a mechanism to dynamically load an instrumentation engine at runtime.

To do that:

- Include `instrmt/instrmt.hxx` and instrument your code.
- Link against the `instrmt` library:

  ```sh
  g++ main.cpp -I/path/to/instrmt/include -L/path/to/instrmt/lib -linstrmt -ldl -o main
  ```

  Or using CMake:

  ```cmake
  find_package(Instrmt)
  add_executable(main main.cpp)
  target_link_libraries(main PRIVATE instrmt)
  ```

- When launching your application, specify the engine to load using the `INSTRMT_ENGINE` environment variable.

  ```sh
  $ ./main
  # No instrumentation

  $ INSTRMT_ENGINE=/path/to/instrmt/lib/libinstrmt-tty.so ./main
  f                                0.0ms
  ```

### Static wrapper

If the dynamic wrapper has too much overhead, Instrmt can be used as a simple wrapper, providing just a common API (the macros) for other instrumentation libraries.

Wrappers for the _tty_, _itt_ & _tracy_ engines are provided.

To use a wrapper:

- Include `instrmt/instrmt.hxx` and instrument your code.
- Add the following define: `INSTRMT_CXX_WRAPPER=\"instrmt/xxx/xxx-wrapper.hxx\"` (with the double quotes).
- Import the underlying library (your compiler needs to find its includes and link against it).

#### TTY wrapper

```sh
g++ main.cpp -I/path/to/instrmt/include \
  -DINSTRMT_CXX_WRAPPER=\"instrmt/tty/tty-wrapper.hxx\" \
  -o main
```

Or using CMake:

```cmake
find_package(Instrmt)
add_executable(main main.cpp)
target_link_libraries(main instrmt-tty-wrapper)
```

#### ITT wrapper

```sh
g++ main.cpp -I/path/to/instrmt/include -I/path/to/ittnotify/include \
  -DINSTRMT_CXX_WRAPPER=\"instrmt/itt/itt-wrapper.hxx\" \
  -L/path/to/ittnotify/lib -littnotify -lpthread -ldl \
  -o main
```

Or using CMake:

```cmake
find_package(Instrmt)
add_executable(main main.cpp)
target_link_libraries(main instrmt-itt-wrapper)
```

#### Tracy wrapper

```sh
g++ main.cpp -I/path/to/instrmt/include -I/path/to/tracy/include \
  -DINSTRMT_CXX_WRAPPER=\"instrmt/tracy/tracy-wrapper.hxx\" \
  -DTRACY_ENABLE \
  -L/path/to/tracy/lib -lTracyClient -lpthread -ldl \
  -o main
```

Or using CMake:

```cmake
find_package(Instrmt)
add_executable(main main.cpp)
target_link_libraries(main instrmt-tracy-wrapper)
```

## Noop implementation

When `INSTRMT_ENGINE` is not defined, every macro that instrument your code still has a small runtime overhead.
Your application also needlessly links to (and has to be shipped with) the `instrmt` library.

All the macros can be turned noop, reducing the runtime overhead to zero, by adding the `INSTRMT_DISABLE` compile definition:

```sh
g++ main.cpp -I/path/to/instrmt/include -DINSTRMT_DISABLE -o main # No -linstrmt
```

Using CMake, link to the `instrmt-noop` target instead:

```cmake
target_link_libraries(main PRIVATE instrmt-noop)
```

## Available engines

### TTY

Available options (not available in static wrapper mode at the moment):

- `INSTRMT_TTY_OUT=stderr|stdout|<a file>`: Specify where to print the output.\
  When outputing to a file, if `%date%` is found in the filename, it will be replaced by the current date.
- `INSTRMT_TTY_TRUNCATE_OUT`: Cause the output file to be truncated before writing to it.
- `INSTRMT_TTY_COLOR=auto|yes|no`: Enable/disable colored output (default: auto).
- `INSTRMT_TTY_FORMAT=text|csv`: Specify the output format (default: text).

### ITT

Note: Despite ITT API having an API for messages, VTune does not support them.

### Tracy

## License

This project is released under the terms of the MIT License. See the LICENSE.txt file for more details.
