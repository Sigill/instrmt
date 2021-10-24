#!/usr/bin/env node

// See https://github.com/gajus/global-agent for proxy configuration
import * as global_agent from 'global-agent';
global_agent.bootstrap();

import assert from 'assert';
import dargs from 'dargs';
import execa from 'execa';
import fs from 'fs';
import * as fse from 'fs-extra';
import glob from 'glob';
import got from 'got';
import isInteractive from 'is-interactive';
import isPromise from 'p-is-promise';
import hasbin from 'hasbin';
import hasha from 'hasha';
import mkdirp from 'mkdirp';
import os from 'os';
import path from 'path';
import pathIsInside from 'path-is-inside';
import {promisify} from 'util';
import replaceInFile from 'replace-in-file';
import rimraf from 'rimraf';
import semver from 'semver';
import shellquote from 'shell-quote';
import stream from 'stream';
import tar from 'tar';
import commander from 'commander';

// https://techsparx.com/nodejs/esnext/dirname-es-modules.html
const __dirname = path.dirname(new URL(import.meta.url).pathname);


const nproc = os.cpus().length;

function as_array(arg) {
  if (Array.isArray(arg))
    return arg;
  if (arg === undefined)
    return [];
  return [arg];
}

function resolve_directories(basename, workdir, { buildInSource = false, skipInstall = false } = {}) {
  const tmpdir = path.join(workdir, 'tmp');
  const install = path.join(workdir, basename);

  if (buildInSource) {
    if (skipInstall) {
      const src = path.join(workdir, basename);
      return {
        src: src,
        build: src,
        install,
        temp: []
      };
    } else {
      const src = path.join(tmpdir, `${basename}-src`);
      return {
        src: src,
        build: path.join(workdir, basename),
        install,
        temp: [src]
      };
    }
  } else {
    if (skipInstall) {
      return {
        src: path.join(workdir, `${basename}-src`),
        build: path.join(workdir, basename),
        install,
        temp: []
      };
    } else {
      const tmp = path.join(tmpdir, basename);
      return {
        src: path.join(tmp, 'src'),
        build: path.join(tmp, 'bld'),
        install,
        temp: [tmp]
      };
    }
  }
}

function cmake_configure_command(src, bld, {cmake='cmake', buildType, installPrefix, args = []} = {}) {
  var cmd = [cmake, '-S', src, '-B', bld];
  if (buildType)
    cmd.push(`-DCMAKE_BUILD_TYPE=${buildType}`);
  if (installPrefix)
    cmd.push(`-DCMAKE_INSTALL_PREFIX=${installPrefix}`);
  cmd.push(...as_array(args));
  return cmd;
}

function cmake_build_command(bld, {cmake='cmake', target} = {}) {
  var cmd = [cmake, '--build', bld];
  if (target !== undefined)
    cmd.push('--target', target);
  cmd.push('-j', `${nproc}`);
  return cmd;
}

function install(files, dir, {filename, base} = {}) {
  files = as_array(files);
  assert(files.length > 0, 'No files to install');
  assert(filename === undefined || files.length === 1, 'Cannot use the "filename" option when installing multiple files');

  const finalPath = f => {
    let p = base ? path.join(dir, path.relative(base, f)) : path.join(dir, path.basename(f));
    if (filename) {
      p = path.join(path.dirname(p), filename);
    }
    return p;
  };

  if (base) {
    files.forEach(f => assert(pathIsInside(f, base), `"${f}" not in "${base}"`));
  }

  const final_paths = files.map(f => finalPath(f)).map(f => path.dirname(f));
  new Set(final_paths).forEach(d => mkdirp.sync(d));

  files.forEach(f => {
    fse.copySync(f, finalPath(f), {preserveTimestamps : true});
  });
}

function sed(files, from, to) {
  replaceInFile.sync({files, from, to})
    .filter(result => !result.hasChanged)
    .forEach(result => { throw new Error(`${result.file}: No match for ${from}`); });
}

function requiredArg(name) {
  throw new Error(`missing required parameter: ${name}`);
}

function pretty_version(v) {
  const is_semver = v.match(/^v?(?:(\d+))(?:\.(\d+))?(\.\d+)?$/);
  if (!is_semver) return v;
  return semver.valid(semver.coerce(v));
}

function match_version(version, {tag = [], range} = {}) {
  version = pretty_version(version);

  if (as_array(tag).includes(version))
    return true;

  if (range && semver.valid(version) && semver.satisfies(version, range)) {
    return true;
  }

  return false;
}

function isDirectory(p) {
  return fs.existsSync(p) && fs.lstatSync(p).isDirectory();
}

function unbuffer(command) {
  if (hasbin.sync('unbuffer')) {
    return ['unbuffer', command];
  } else {
    return [command[0], command.slice(1)];
  }
}

function pretty_command(command, {env, cwd} = {}) {
  const prefix = [];
  if (env || cwd) {
    prefix.push('env');
    if (cwd) {
      prefix.push('-C', cwd);
    }
    if (env) {
      Object.entries(env).forEach(([k, v]) => {
        prefix.push(`${k}=${v}`);
      });
    }
  }
  return shellquote.quote([...prefix, ...command]);
}

function instrmt_configure_command(srcdir, builddir, {cmake, buildType, installPrefix, ittapi, tracy, googleBenchmark, vendorDir, enableTests=true, args = []} = {}) {
  let cmakeArgs = [];

  cmakeArgs.push(`-DINSTRMT_BUILD_ITT_ENGINE=${ittapi ? 'ON' : 'OFF'}`);
  if (ittapi) {
    if (ittapi === true)
      ittapi = dependency('ittapi').path(vendorDir);
    cmakeArgs.push(`-DVTUNE_ROOT=${ittapi}`);
  }

  cmakeArgs.push(`-DINSTRMT_BUILD_TRACY_ENGINE=${tracy ? 'ON' : 'OFF'}`);
  if (tracy) {
    if (tracy === true)
      tracy = dependency('tracy').path(vendorDir);
    cmakeArgs.push(`-DTRACY_ROOT=${tracy}`);
  }

  cmakeArgs.push(`-DBUILD_BENCHMARKS=${googleBenchmark ? 'ON' : 'OFF'}`);
  if (googleBenchmark) {
    if (googleBenchmark === true)
      googleBenchmark = path.join(dependency('google-benchmark').path(vendorDir), 'lib', 'cmake', 'benchmark');
    cmakeArgs.push(`-Dbenchmark_DIR=${googleBenchmark}`);
  }

  cmakeArgs.push(`-DBUILD_TESTING=${enableTests ? 'ON' : 'OFF'}`);

  cmakeArgs = cmakeArgs.concat(args);

  return cmake_configure_command(srcdir, builddir, {cmake, buildType, installPrefix, args: cmakeArgs});
}

function step({title, action = requiredArg('action'), skip} = {}) {
  assert(!skip || title, 'Title required for skippable tasks');

  if (title)
    console.log(`[STARTED] ${title}`);

  const skipped = skip && skip();
  if (skipped) {
    console.log(typeof skipped == 'string' ? `[SKIPPED] ${skipped}` : `[SKIPPED]`);
    return;
  }

  const log_finish = (status, start) => {
    if (title) {
      const finish = new Date();
      console.log(`[${status}] ${title} (${((finish - start)/1000).toFixed(1)}s)`);
    }
  };

  const start = new Date();

  try {
    let result = action();

    if (isPromise(result)) {
      result = result.then(args => {
        log_finish('SUCCESS', start);
        return args;
      }).catch(err => {
        log_finish('FAILED', start);
        throw err;
      });
    } else {
      log_finish('SUCCESS', start);
    }

    return result;
  } catch (err) {
    log_finish('FAILED', start);
    throw err;
  }
}

function steps({quiet} = {}) {
  return {
    execa: function(command, {title, skip, env, cwd} = {}) {
      return step({
        title: title || pretty_command(command, {cwd, env}),
        skip,
        action: () => {
          let p = quiet
            ? execa(...unbuffer(command), {env, cwd, all: true})
            : execa(command[0], command.slice(1), {env, cwd, stdio: 'inherit'});
          return p
            .catch(err => {
              if (err.exitCode) {
                if (err.all) console.log(err.all);
                throw new Error(`Command failed with exit code ${err.exitCode}`);
              } else throw err;
            });
        }
      });
    },
    download: function(url, file) {
      const pipeline = promisify(stream.pipeline);
      return step({
        title: `Download ${url}`,
        skip: () => fs.existsSync(file) && (quiet || `${file} already exists`),
        action: () => mkdirp(path.dirname(file)).then(() => pipeline(got.stream(url), fs.createWriteStream(file)))
      });
    },
    checksum: function (file, expected_checksum) {
      return step({
        title: `Verify checksum of ${file}`,
        skip: () => !expected_checksum && (quiet || 'Checksum not specified'),
        action: () => {
          const {algorithm, hash: expected_hash} = expected_checksum;
          return hasha.fromFile(file, {algorithm}).then(actual_hash => {
            if (actual_hash !== expected_hash)
              throw new Error(`${algorithm}(${file}) = ${actual_hash} != ${expected_hash}`);
          });
        }
      });
    },
    extract: function(archive, dest, {strip_components} = {}) {
      return step({
        title: `Extract ${archive}`,
        action: () => mkdirp(dest).then(() => tar.x({ file: archive, strip: strip_components, C: dest }))
      });
    },
    download_and_extract: function(url, archive, checksum, dest, {strip_components} = {}) {
      return step({
        action: async () => {
          await this.download(url, archive);
          await this.checksum(archive, checksum);
          await this.extract(archive, dest, {strip_components});
        }
      });
    },
    cleanup: function(files) {
      return step({
        title: 'Cleanup',
        action: () => as_array(files).forEach(e => rimraf.sync(e))
      });
    },
    fetch_cmake28: function({directory = requiredArg('directory')} = {}) {
      const dirs = resolve_directories('cmake-2.8.12', directory);
      const url = 'https://github.com/Kitware/CMake/archive/v2.8.12.tar.gz';
      const archive = path.join(directory, 'cmake-2.8.12.tar.gz');

      return step({
        title: 'Fetch CMake 2.8.12',
        skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
        action: async () => {
          await this.download_and_extract(url, archive, '0dc2118e56f5c02dc5a90be9bd19befc', dirs.src, {strip_components: 1});
          await this.execa(['patch', '-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'cmake2812-noqt.diff')]);
          mkdirp.sync(dirs.build);
          await this.execa(
            [path.join(dirs.src, 'bootstrap'), `--parallel=${nproc}`, '--no-qt-gui', `--prefix=${dirs.install}`],
            {cwd: dirs.build}
          );
          await this.execa(['make', '-C', dirs.build, `-j${nproc}`, 'install']);
          this.cleanup(dirs.temp);
        }
      });
    },
    fetch_cmake3: function({directory = requiredArg('directory'), version = requiredArg('version'), checksum} = {}) {
      const dirs = {install: path.join(directory, `cmake-${version}`)};
      const url = `https://github.com/Kitware/CMake/releases/download/v${version}/cmake-${version}-Linux-x86_64.tar.gz`;
      const archive = path.join(directory, `cmake-${version}-Linux-x86_64.tar.gz`);

      return step({
        title: 'Fetch CMake 3',
        skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
        action: async () => await this.download_and_extract(url, archive, checksum, dirs.install, {strip_components: 1})
      });
    },
    fetch_ittapi: function({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType} = {}) {
      const dirs = resolve_directories(dependency('ittapi', version).basename(suffix), directory);
      const url = `https://github.com/intel/ittapi/archive/${version}.tar.gz`;
      const archive = path.join(directory, `ittapi-${version}.tar.gz`);

      return step({
        title: 'Fetch ittapi',
        skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
        action: async () => {
          await this.download_and_extract(url, archive, checksum, dirs.src, {strip_components: 1});
          await this.execa( cmake_configure_command(dirs.src, dirs.build, {buildType: cmakeBuildType, args: []}) ),
          await this.execa(cmake_build_command(dirs.build)),
          await step({
            title: 'Install',
            action: () => {
              const headers = glob.sync(path.join(dirs.src, 'include', '**', '*.h?(pp)'));
              install(headers, path.join(dirs.install, 'include'), {base: path.join(dirs.src, 'include')});
              install(
                path.join(dirs.build, 'bin', 'libittnotify.a'),
                path.join(dirs.install, 'lib64')
              );
            }
          });
          this.cleanup(dirs.temp);
        }
      });
    },
    fetch_capstone: function({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType} = {}) {
      const dirs = resolve_directories(dependency('capstone', version).basename(suffix), directory);
      const url = `https://github.com/aquynh/capstone/archive/${version}.tar.gz`;
      const archive = path.join(directory, `capstone-${version}.tar.gz`);

      return step({
        title: 'Fetch capstone',
        skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
        action: async () => {
          await this.download_and_extract(url, archive, checksum, dirs.src, {strip_components: 1});
          await this.execa(['patch', '-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'capstone-pkgconfig-includedir.diff')]);
          await this.execa(
            cmake_configure_command(dirs.src, dirs.build, {buildType: cmakeBuildType, installPrefix: dirs.install, args: ['-DCAPSTONE_BUILD_TESTS=OFF']})
          );
          await this.execa( cmake_build_command(dirs.build, {target: 'install'}) );
          await step({
            title: 'Drop dynamic libraries', // To force the use of the static ones when building tracy's capture & profiler.
            action: () => {
              glob.sync(path.join(dirs.install, 'lib', 'libcapstone.so*')).forEach(f => fs.rmSync(f));
            }
          });
          this.cleanup(dirs.temp);
        }
      });
    },
    fetch_glfw: function({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType} = {}) {
      const dirs = resolve_directories(dependency('glfw', version).basename(suffix), directory);
      const url = `https://github.com/glfw/glfw/archive/${version}.tar.gz`;
      const archive = path.join(directory, `glfw-${version}.tar.gz`);

      return step({
        title: 'Fetch glfw',
        skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
        action: async () => {
          await this.download_and_extract(url, archive, checksum, dirs.src, {strip_components: 1});
          await this.execa(
            cmake_configure_command(
              dirs.src, dirs.build,
              {
                buildType: cmakeBuildType, installPrefix: dirs.install,
                args: ['-DGLFW_BUILD_DOCS=OFF', '-DGLFW_BUILD_EXAMPLES=OFF', '-DGLFW_BUILD_TESTS=OFF']
              }
            )
          );
          await this.execa(cmake_build_command(dirs.build, {target: 'install'}));
          step({
            title: 'Fix pkgconfig file',
            action: () => {
              sed(path.join(dirs.install, 'lib/pkgconfig/glfw3.pc'), 'Requires.private:  x11', 'Requires:  x11');
            }
          });
          this.cleanup(dirs.temp);
        }
      });
    },
    fetch_tracy: function({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, components, withGlfw, withCapstone} = {}) {
      const dirs = resolve_directories(dependency('tracy', version).basename(suffix), directory, {buildInSource: true});
      const url = `https://github.com/wolfpld/tracy/archive/${version}.tar.gz`;
      const archive = path.join(directory, `tracy-${version}.tar.gz`);

      const buildStep = (directory, {extra_pc_dirs = [], skip} = {}) => {
        const env = extra_pc_dirs.length === 0
          ? undefined
          : {PKG_CONFIG_PATH: extra_pc_dirs.concat((process.env.PKG_CONFIG_PATH || '').split(path.delimiter).filter(e => e)).join(path.delimiter)};
        return this.execa(['make', '-C', directory, '-j', `${nproc}`, 'release'], {env, skip});
      };

      const installHeaders = (...subdirs) => {
        const files = glob.sync(path.join(dirs.src, ...subdirs, '*.h?(pp)'));
        install(files, path.join(dirs.install, 'include', ...subdirs));
      };

      return step({
        title: 'Fetch tracy',
        skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
        action: async () => {
          await this.download_and_extract(url, archive, checksum, dirs.src, {strip_components: 1});
          await this.execa(
            ['patch', '-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'tracy-pkgconfig-static.diff')],
            {
              skip: () => !match_version(version, {range: '>=0.7 <=0.7.2'}) && (quiet || `Not required for version ${version}`)
            }
          );
          await step({
            title: `Fix includes`,
            skip: () => !match_version(version, {tag: 'master', range: '>=0.7.6'}) && (quiet || `Not required for version ${version}`),
            action: () => {
              ['TracyWorker.cpp', 'TracySourceView.cpp'].forEach(f => {
                sed(path.join(dirs.src, 'server', f), 'capstone.h', 'capstone/capstone.h');
              });
            }
          });
          if (components.includes('lib')) {
            await step({
              title: 'Build library',
              action: async () => {
                const workdir = path.join(dirs.src, 'library', 'unix');
                await buildStep(workdir);
                await step({
                  title: 'Install library',
                  action: () => {
                    install(path.join(workdir, 'libtracy-release.so'), path.join(dirs.install, 'lib'), {filename: 'libtracy.so'});

                    installHeaders();
                    installHeaders('client');
                    installHeaders('common');
                  }
                });
              }
            });
          }
          if (components.includes('capture')) {
            await step({
              title: 'Build capture tool',
              action: async () => {
                const workdir = path.join(dirs.src, 'capture', 'build', 'unix');
                await buildStep(workdir, {extra_pc_dirs: [withCapstone].filter(e => e).map(d => path.join(d, 'lib', 'pkgconfig'))});
                await step({
                  title: 'Install capture',
                  action: () => {
                    install(path.join(workdir, 'capture-release'), path.join(dirs.install, 'bin'), {filename: 'capture'});
                  }
                });
              }
            });
          }
          if (components.includes('profiler')) {
            await step({
              title: 'Build profiler',
              action: async () => {
                const workdir = path.join(dirs.src, 'profiler', 'build', 'unix');
                await buildStep(workdir, {extra_pc_dirs: [withCapstone, withGlfw].filter(e => e).map(d => path.join(d, 'lib', 'pkgconfig'))});
                await step({
                  title: 'Install profiler',
                  action: () => {
                    install(path.join(workdir, 'Tracy-release'), path.join(dirs.install, 'bin'), {filename: 'tracy'});
                  }
                });
              }
            });
          }
          this.cleanup(dirs.temp);
        }
      });
    },
    fetch_google_benchmark: function({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType} = {}) {
      const dirs = resolve_directories(dependency('google-benchmark', version).basename(suffix), directory);
      const url = `https://github.com/google/benchmark/archive/${version}.tar.gz`;
      const archive = path.join(directory, `google-benchmark-${version}.tar.gz`);

      return step({
        title: 'Fetch google-benchmark',
        skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
        action: async () => {
          await this.download_and_extract(url, archive, checksum, dirs.src, {strip_components: 1});
          await this.execa(
            cmake_configure_command(dirs.src, dirs.build,
                                    {buildType: cmakeBuildType, installPrefix: dirs.install, args: ['-DBENCHMARK_ENABLE_TESTING=OFF']})
          );
          await this.execa(cmake_build_command(dirs.build, {target: 'install'}));
          this.cleanup(dirs.temp);
        }
      });
    },
    configure_build_instrmt: function(buildDir, {cmake, buildType, installPrefix, ittapi, tracy, googleBenchmark, enableTests=true, cmakeArgs = [], build}) {
      const configure_command = instrmt_configure_command(
        __dirname,
        buildDir,
        {
          cmake,
          buildType, installPrefix, ittapi, tracy, googleBenchmark,
          vendorDir: path.join(__dirname, 'vendor'),
          enableTests,
          args: cmakeArgs
        }
      );

      return step({
        action: async () => {
          await this.execa(configure_command);

          if (build) {
            const build_command = cmake_build_command(buildDir, {target: build === true ? undefined : build});
            await this.execa(build_command);
          }
        }
      });
    },
    build_instmt_example: async function(instrmt_dir, build_dir, cmake, ittapi_root, tracy_root) {
      const that = this;
      const configure_command = cmake_configure_command(
        path.join(__dirname, 'example'), build_dir,
        {
          buildType: 'Release',
          cmake,
          args: [`-DInstrmt_DIR=${instrmt_dir}`, `-DVTUNE_ROOT=${ittapi_root}`, `-DTRACY_ROOT=${tracy_root}`]
        }
      );

      const build_command = cmake_build_command(build_dir, {cmake});

      await that.execa(configure_command);
      await that.execa(build_command);
    },
    verify_instrmt_cmake_integration: async function(instrmt_build_dir, instrmt_install_dir, workdir, ittapi_root, tracy_root, {cmake} = {}) {
      const that = this;
      const example_task = (title, instrmt_dir, build_dir) => {
        return step({
          title,
          action: () => that.build_instmt_example(
            instrmt_dir,
            path.join(workdir, build_dir),
            cmake, ittapi_root, tracy_root
          )
        });
      };

      await example_task('Check build tree CMake intergration', instrmt_build_dir, 'example-from-build');
      await example_task('Check install tree CMake intergration', path.join(instrmt_install_dir, 'share', 'cmake', 'instrmt'), 'example-from-install');
    }
  };
}

function absolute_path(p) { return path.resolve(p); }

const dependencies = {
  cmake3: {
    basename: 'cmake',
    default_version: '3.20.0',
    '3.20.0': { checksum: { algorithm: 'md5', hash: '9775844c038dd0b2ed80bce4747ba6bf' } }
  },
  ittapi: {
    default_version: '8cd2618',
    '8cd2618': { checksum: { algorithm: 'md5', hash: '5920c512a7a7c8971f2ffe6f693ffff3' } }
  },
  capstone: {
    default_version: '4.0.2',
    '4.0.2': { checksum: { algorithm: 'md5', hash: '8894344c966a948f1248e66c91b53e2c' } }
  },
  glfw: {
    default_version: '3.3.4',
    '3.3.4': { checksum: { algorithm: 'md5', hash: '8f8e5e931ef61c6a8e82199aabffe65a' } }
  },
  tracy: {
    default_version: 'v0.7.6',
    'v0.7.2': { checksum: { algorithm: 'md5', hash: 'bceb615c494c3f7ccb77ba3bae20b216' } },
    'v0.7.6': { checksum: { algorithm: 'md5', hash: '828be21907a1bddf5762118cf9e3ff66' } }
  },
  'google-benchmark': {
    default_version: 'v1.5.3',
    'v1.5.3': { checksum: { algorithm: 'md5', hash: 'abb43ef7784eaf0f7a98aed560920f46' } }
  }
};

function dependency(name, version) {
  assert(dependencies[name], `Unknown dependency ${name}`);
  version ||= dependencies[name].default_version;

  return {
    basename: function(suffix) {
      return [dependencies[name].basename || name, pretty_version(version), suffix].filter(e => e).join('-');
    },
    path: function(prefix = path.join(__dirname, 'vendor')) {
      return path.join(prefix, this.basename());
    },
    checksum: dependencies[name]?.[version]?.checksum,
    version: version
  };
}

const program = new commander.Command();

function FetchCommand(name, {pretty_name, version, suffix, checksum, cmakeBuildType} = {}) {
  const cmd = program
    .command(`fetch-${name}`)
    .description(`Fetch ${pretty_name || name}.`)
    .option('-C, --directory <directory>', 'Change to DIR before performing any operations.', absolute_path,
            __dirname === process.cwd() ? path.join(process.cwd(), 'vendor') : process.cwd())
    .option('-q, --quiet', 'Hide non-essential messages (e.g. only display external commands output if they fail).');

  if (version) {
    cmd.option('-v, --version <value>', 'Overrides version.', dependency(name).version);
  }

  if (suffix) {
    cmd.option('-s, --suffix <value>', 'Suffix to append on directory name.');
  }

  if (checksum) {
    assert(version, '"checkum" option requires "version" option');

    cmd.option('-c, --checksum <value>', 'Overrides checksum.');
    cmd.hook('preAction', (thisCommand, actionCommand) => {
      actionCommand.opts().checksum ??= dependency(name, actionCommand.opts().version).checksum;
    });
  }

  if (cmakeBuildType) {
    cmd.option('--cmake-build-type <value>', 'Overrides CMAKE_BUILD_TYPE.', 'Release');
  }

  return cmd;
}

FetchCommand('cmake28', {pretty_name: 'CMake 2.8.12'})
  .action((options) => steps(options).fetch_cmake28(options));

FetchCommand('cmake3', {pretty_name: 'CMake 3.x', version: true, checksum: true})
  .action((options) => steps(options).fetch_cmake3(options));

FetchCommand('ittapi', {pretty_name: 'ITT API', version: true, suffix: true, checksum: true, cmakeBuildType: true})
  .action((options) => steps(options).fetch_ittapi(options));

FetchCommand('capstone', {pretty_name: 'Capstone', version: true, suffix: true, checksum: true, cmakeBuildType: true})
  .action((options) => steps(options).fetch_capstone(options));

FetchCommand('glfw', {pretty_name: 'GLFW', version: true, suffix: true, checksum: true, cmakeBuildType: true})
  .action((options) => steps(options).fetch_glfw(options));

FetchCommand('tracy', {pretty_name: 'Tracy', version: true, suffix: true, checksum: true})
  .addOption(new commander.Option('--components <value...>', 'Components to build.').choices(['lib', 'capture', 'profiler']).default(['lib']))
  .option('--with-glfw <directory>', 'Root directory of glfw (location of lib/pkgconfig/glfw3.pc).')
  .hook('preAction', (thisCommand, actionCommand) => {
    actionCommand.opts().withGlfw ??= dependency('glfw').path(actionCommand.opts().directory);
  })
  .option('--with-capstone <directory>', 'Root directory of capstone (location of lib/pkgconfig/capstone.pc).')
  .hook('preAction', (thisCommand, actionCommand) => {
    actionCommand.opts().withCapstone ??= dependency('capstone').path(actionCommand.opts().directory);
  })
  .action((options) => steps(options).fetch_tracy(options));

FetchCommand('google-benchmark', {version: true, suffix: true, checksum: true, cmakeBuildType: true})
  .action((options) => steps(options).fetch_google_benchmark(options));

program
  .command('fetch-dependencies')
  .description('Download and build dependencies.')
  .option('-C, --directory <directory>', 'Change to DIR before performing any operations.', absolute_path,
          __dirname === process.cwd() ? path.join(process.cwd(), 'vendor') : process.cwd())
  .option('-q, --quiet', 'Hide non-essential messages (e.g. only display external commands output if they fail).')
  .action(async (options) => {
    const directory = options.directory;
    await steps(options).fetch_ittapi({directory, version: dependency('ittapi').version, checksum: dependency('ittapi').checksum, cmakeBuildType: 'Release'});
    await steps(options).fetch_tracy({directory, version: dependency('tracy').version, checksum: dependency('tracy').checksum, components: ['lib']});
    await steps(options).fetch_google_benchmark({directory, version: dependency('google-benchmark').version, checksum: dependency('google-benchmark').checksum, cmakeBuildType: 'Release'});
  });

program
  .command('configure')
  .description('Configure the build.')
  .option('-C --directory <directory>', 'Change to DIR before performing any operations.', absolute_path,
          __dirname === process.cwd() ? path.join(__dirname, 'build') : process.cwd())
  .option('--cmake-build-type <value>', 'Overrides CMAKE_BUILD_TYPE.', 'Release')
  .option('--with-ittapi [directory]', absolute_path)
  .option('--with-tracy [directory]', absolute_path)
  .option('--with-benchmarks [directory]', absolute_path)
  .option('--build [target]')
  .option('-q, --quiet', 'Hide non-essential messages (e.g. only display external commands output if they fail).')
  .action((options, command) => steps(options).configure_build_instrmt(
    options.directory,
    {
      buildType: options.cmakeBuildType,
      ittapi: options.withIttapi,
      tracy: options.withTracy,
      googleBenchmark: options.withBenchmarks,
      enableTests: true,
      cmakeArgs: command.args,
      build: options.build
    }
  ));

program
  .command('cmake-integration')
  .description('Run integration tests')
  .option('--ittapi-root <directory>', '', absolute_path, dependency('ittapi').path(path.join(__dirname, 'vendor')))
  .option('--tracy-root <directory>', '', absolute_path, dependency('tracy').path(path.join(__dirname, 'vendor')))
  .option('--cmake <file>', '', absolute_path, 'cmake')
  .option('-q, --quiet', 'Hide non-essential messages (e.g. only display external commands output if they fail).')
  .action(async (options) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'instrmt-it-'));
    const instrmt_bld = path.join(temp, 'instrmt-build');
    const instrmt_dist = path.join(temp, 'instrmt-install');

    await steps(options).configure_build_instrmt(
      instrmt_bld,
      {
        buildType: 'Release',
        installPrefix: instrmt_dist,
        ittapi: options.ittapiRoot,
        tracy: options.tracyRoot,
        enableTests: false,
        build: 'install'
      }
    );
    await steps(options).verify_instrmt_cmake_integration(instrmt_bld, instrmt_dist, temp, options.ittapiRoot, options.tracyRoot, {cmake: options.cmake});
    steps(options).cleanup(temp);
  });

function start_ci_container(options) {
  const branch = execa.sync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.toString();

  execa.sync('docker', ['volume', 'create', 'instrmt-build-cache']);

  const step_exe = options.quiet ? `step -q` : `step`;

  const commands = [
    `${step_exe} git clone --depth 1 -b ${branch} /repo /src`,
    `${step_exe} mkdir -p /cache/node_modules /cache/vendor`,
    `${step_exe} ln -snf /cache/node_modules /src/node_modules`,
    `${step_exe} ln -snf /cache/vendor /src/vendor`
  ];

  if (!options.fast)
    commands.push(`${step_exe} npm i --production --prefer-offline --no-audit --progress=false`);

  commands.push(shellquote.quote([
    'step', 'node', 'bootstrap.js', 'ci', // Not step -q otherwise there would be no output
    ...dargs(options, {includes: ['fast', 'warningAsError', 'quiet'], ignoreFalse: true}),
    ...dargs(options, {includes: ['fullBuild', 'cmakeIntegration', 'runTests'], ignoreTrue: true}),
    ...dargs(options, {includes: ['cmakeVersion', 'ittapiVersion', 'tracyVersion', 'googleBenchmarkVersion']}),
  ]));

  let command_string = commands.join(' && ');

  if (options.shell) {
    if (!isInteractive())
      throw new Error('Host terminal is not a TTY, the --shell option cannot be used.');
    command_string = `${command_string} ; bash`;
  }

  const shellFlags = function*() {
    if (options.shell) yield '-i';
    if (options.shell || isInteractive()) yield '-t';
  };

  const docker_command = [
    'docker', 'run', '--rm', ...shellFlags(), '-v', `${__dirname}:/repo:ro`, '--mount', 'source=instrmt-build-cache,target=/cache',
    'instrmt-build',
    'bash', '-c', command_string
  ];

  return step({
    title: shellquote.quote(docker_command),
    action: () => execa(docker_command[0], docker_command.slice(1), {stdio: 'inherit'})
      .catch(err => { throw new Error(`Command failed with exit code ${err.exitCode}`); })
  });
}

program
  .command('ci')
  .option('--docker', 'Run on a fresh clone in a docker container')
  .option('--shell', 'Keep shell open at the end.')
  .option('--fast', 'Skip npm modules and dependencies installation.')
  .option('--cmake-version <version>', 'Version of CMake to use')
  .option('--ittapi-version <version>', 'Version of ITT API to use', dependency('ittapi').version)
  .option('--tracy-version <version>', 'Version of Tracy to use', dependency('tracy').version)
  .option('--google-benchmark-version <version>', '', dependency('google-benchmark').version)
  .option('--no-full-build', 'Build everything.')
  .option('--no-cmake-integration', 'Verify CMake integration.')
  .option('--no-run-tests', 'Run tests.')
  .option('-W, --warning-as-error', 'Build with -Werror.')
  .option('-q, --quiet', 'Hide non-essential messages (e.g. only display external commands output if they fail).')
  .action(async (options) => {
    if (options.docker) {
      return start_ci_container(options);
    }

    return step({
      title: 'CI',
      action: async () => {
        const {fast, fullBuild, cmakeIntegration, runTests, warningAsError} = options;

        const cmake = options.cmakeVersion ? dependency('cmake3', options.cmakeVersion === true ? dependency('cmake3').version : options.cmakeVersion) : undefined;
        const ittapi = dependency('ittapi', options.ittapiVersion);
        const tracy = dependency('tracy', options.tracyVersion);
        const google_benchmark = dependency('google-benchmark', options.googleBenchmarkVersion);

        if (cmake)
          process.env.PATH = [path.join(cmake.path(), 'bin')].concat((process.env.PATH || '').split(path.delimiter).filter(e => e)).join(path.delimiter);

        const vendorDir = path.join(__dirname, 'vendor');

        if (!fast) {
          if (cmake) {
            await steps(options).fetch_cmake3({directory: vendorDir, version: cmake.version, checksum: cmake.checksum});
          }
          await steps(options).fetch_ittapi({directory: vendorDir, version: ittapi.version, checksum: ittapi.checksum});
          await steps(options).fetch_tracy({directory: vendorDir, version: tracy.version, checksum: tracy.checksum, components: ['lib']});
          if (fullBuild) {
            await steps(options).fetch_google_benchmark({directory: vendorDir, version: google_benchmark.version, checksum: google_benchmark.checksum});
          }
        }

        const tempdir = fs.mkdtempSync(path.join(os.tmpdir(), 'instrmt-'));

        const instrmt_bld = path.join(tempdir, 'instrmt-build');
        const instrmt_dist = cmakeIntegration ? path.join(tempdir, 'instrmt-install') : undefined;

        await steps(options).configure_build_instrmt(
          instrmt_bld,
          {
            buildType: 'Release',
            installPrefix: instrmt_dist,
            ittapi: ittapi.path(),
            tracy: tracy.path(),
            googleBenchmark: fullBuild ? path.join(google_benchmark.path(), 'lib', 'cmake', 'benchmark') : false,
            enableTests: fullBuild,
            build: instrmt_dist ? 'install' : true,
            cmakeArgs: warningAsError ? ['-DCMAKE_CXX_FLAGS=-Werror'] : []
          }
        );

        if (runTests) {
          await steps(options).execa(['ctest'], {cwd: instrmt_bld});
        }

        if (cmakeIntegration) {
          await steps(options).verify_instrmt_cmake_integration(instrmt_bld, instrmt_dist, tempdir, ittapi.path(), tracy.path());
        }

        steps(options).cleanup(tempdir);
      }
    });
  });

program.parseAsync(process.argv)
  .catch(err => {
    console.error(err);
    process.exitCode = -1;
  });