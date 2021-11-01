#!/usr/bin/env node

// See https://github.com/gajus/global-agent for proxy configuration
import * as global_agent from 'global-agent';
global_agent.bootstrap();

import assert from 'assert';
import commander from 'commander';
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

// https://techsparx.com/nodejs/esnext/dirname-es-modules.html
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const nproc = os.cpus().length;

const default_vendor_dir = path.join(__dirname, 'vendor');

function as_array(arg) {
  if (Array.isArray(arg))
    return arg;
  if (arg === undefined)
    return [];
  return [arg];
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

function settle(action, onFullfilled, onRejected) {
  onFullfilled ??= (...args) => args;
  onRejected ??= (err) => { throw err; };
  try {
    let result = action();

    if (isPromise(result)) {
      return result.then(args => onFullfilled(args))
        .catch(err => onRejected(err));
    } else {
      return onFullfilled(result);
    }
  } catch (err) {
    onRejected(err);
  }
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

  return settle(action, (...args) => { log_finish('SUCCESS', start); return args; }, (err) => { log_finish('FAILED', start); throw err; });
}

const dependencies = {
  cmake3: {
    basename: 'cmake',
    default_version: '3.21.2',
    '3.21.2': { checksum: { algorithm: 'md5', hash: '68d783b7a6c3ea4d2786cf157f9a6d29' } }
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

function dependency(name, {version, suffix, prefix = default_vendor_dir} = {}) {
  assert(dependencies[name], `Unknown dependency ${name}`);
  version ||= dependencies[name].default_version;
  const basename = [dependencies[name].basename || name, pretty_version(version), suffix].filter(e => e).join('-');
  const root = path.join(prefix, basename);
  const checksum = dependencies[name]?.[version]?.checksum;

  return {
    basename, root, checksum, version,
    build_directories: function({ buildInSource = false, skipInstall = false } = {}) {
      const install = root;

      if (skipInstall) {
        if (buildInSource) {
          return { src: install, build: install, install, temp: [] };
        } else {
          return { src: path.join(prefix, `${basename}-src`), build: install, install, temp: [] };
        }
      } else {
        const src = path.join(prefix, 'tmp', `${basename}-src`);
        if (buildInSource) {
          return { src, build: install, install, temp: [src] };
        } else {
          const build = path.join(prefix, 'tmp', basename, 'build');
          return { src, build, install, temp: [src, build] };
        }
      }
    }
  };
}

function steps({quiet} = {}) {
  return {
    withTempdir: function(prefix = path.join(os.tmpdir(), 'instrmt-'), action = requiredArg('action')) {
      const tempdir = fs.mkdtempSync(prefix);
      const that = this;
      return settle(() => action(tempdir), (...args) => { that.cleanup(tempdir); return args; }, (err) => { that.cleanup(tempdir); throw err; });
    },
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
    fetch_cmake3: async function({directory = default_vendor_dir, version, checksum} = {}) {
      const d = dependency('cmake3', {version, prefix: directory});
      const url = `https://github.com/Kitware/CMake/releases/download/v${d.version}/cmake-${d.version}-Linux-x86_64.tar.gz`;
      const archive = path.join(directory, `cmake-${d.version}-Linux-x86_64.tar.gz`);

      await step({
        title: 'Fetch CMake 3',
        skip: () => isDirectory(d.root) && (quiet || `${d.root} already exists`),
        action: async () => await this.download_and_extract(url, archive, checksum ?? d.checksum, d.root, {strip_components: 1})
      });

      return d;
    },
    fetch_ittapi: async function({directory = default_vendor_dir, version, suffix, checksum, cmakeBuildType} = {}) {
      const d = dependency('ittapi', {version, prefix: directory, suffix});
      const dirs = d.build_directories();
      const url = `https://github.com/intel/ittapi/archive/${d.version}.tar.gz`;
      const archive = path.join(directory, `ittapi-${d.version}.tar.gz`);

      await step({
        title: 'Fetch ittapi',
        skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
        action: async () => {
          await this.download_and_extract(url, archive, checksum ?? d.checksum, dirs.src, {strip_components: 1});
          await this.execa(cmake_configure_command(dirs.src, dirs.build, {buildType: cmakeBuildType, args: []})),
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

      return d;
    },
    fetch_capstone: async function({directory = default_vendor_dir, version, suffix, checksum, cmakeBuildType} = {}) {
      const d = dependency('capstone', {version, prefix: directory, suffix});
      const dirs = d.build_directories();
      const url = `https://github.com/aquynh/capstone/archive/${d.version}.tar.gz`;
      const archive = path.join(directory, `capstone-${d.version}.tar.gz`);

      await step({
        title: 'Fetch capstone',
        skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
        action: async () => {
          await this.download_and_extract(url, archive, checksum ?? d.checksum, dirs.src, {strip_components: 1});
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

      return d;
    },
    fetch_glfw: async function({directory = default_vendor_dir, version, suffix, checksum, cmakeBuildType} = {}) {
      const d = dependency('glfw', {version, prefix: directory, suffix});
      const dirs = d.build_directories();
      const url = `https://github.com/glfw/glfw/archive/${d.version}.tar.gz`;
      const archive = path.join(directory, `glfw-${d.version}.tar.gz`);

      await step({
        title: 'Fetch glfw',
        skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
        action: async () => {
          await this.download_and_extract(url, archive, checksum ?? d.checksum, dirs.src, {strip_components: 1});
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

      return d;
    },
    fetch_tracy: async function({directory = default_vendor_dir, version, suffix, checksum, components, withGlfw, withCapstone} = {}) {
      const d = dependency('tracy', {version, prefix: directory, suffix});
      const dirs = d.build_directories({buildInSource: true});
      const url = `https://github.com/wolfpld/tracy/archive/${d.version}.tar.gz`;
      const archive = path.join(directory, `tracy-${d.version}.tar.gz`);

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

      await step({
        title: 'Fetch tracy',
        skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
        action: async () => {
          await this.download_and_extract(url, archive, checksum ?? d.checksum, dirs.src, {strip_components: 1});
          await this.execa(
            ['patch', '-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'tracy-pkgconfig-static.diff')],
            {
              skip: () => !match_version(d.version, {range: '>=0.7 <=0.7.2'}) && (quiet || `Not required for version ${d.version}`)
            }
          );
          await step({
            title: `Fix includes`,
            skip: () => !match_version(d.version, {tag: 'master', range: '>=0.7.6'}) && (quiet || `Not required for version ${d.version}`),
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

      return d;
    },
    fetch_google_benchmark: async function({directory = default_vendor_dir, version, suffix, checksum, cmakeBuildType} = {}) {
      const d = dependency('google-benchmark', {version, prefix: directory, suffix});
      const dirs = d.build_directories({buildInSource: true});
      const url = `https://github.com/google/benchmark/archive/${d.version}.tar.gz`;
      const archive = path.join(directory, `google-benchmark-${d.version}.tar.gz`);

      await step({
        title: 'Fetch google-benchmark',
        skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
        action: async () => {
          await this.download_and_extract(url, archive, checksum ?? d.checksum, dirs.src, {strip_components: 1});
          await this.execa(
            cmake_configure_command(dirs.src, dirs.build,
                                    {buildType: cmakeBuildType, installPrefix: dirs.install, args: ['-DBENCHMARK_ENABLE_TESTING=OFF']})
          );
          await this.execa(cmake_build_command(dirs.build, {target: 'install'}));
          this.cleanup(dirs.temp);
        }
      });

      return d;
    },
    build_instmt_examples: async function(build_dir, instrmt_dir, ittapi_root, tracy_root, {cmake, args}) {
      const configure_command = cmake_configure_command(
        path.join(__dirname, 'example'), build_dir,
        {
          cmake,
          args: [...(args || []), `-DInstrmt_DIR=${instrmt_dir}`, `-DVTUNE_ROOT=${ittapi_root}`, `-DTRACY_ROOT=${tracy_root}`]
        }
      );

      const build_command = cmake_build_command(build_dir, {cmake});

      await this.execa(configure_command);
      await this.execa(build_command);
    },
    verify_instrmt_cmake_integration: async function(workdir, instrmt_build_dir, instrmt_install_dir, ittapi_root, tracy_root, {cmake, args} = {}) {
      const build_examples = (build_dir, instrmt_dir) => this.build_instmt_examples(
        path.join(workdir, build_dir),
        instrmt_dir, ittapi_root, tracy_root,
        {cmake, args}
      );

      await step({title: 'Check CMake build tree integration', action: () => build_examples('example-from-build', instrmt_build_dir)});
      await step({title: 'Check CMake install tree integration', action: () => build_examples('example-from-install', path.join(instrmt_install_dir, 'share', 'cmake', 'instrmt'))});
    }
  };
}

function absolute_path(p) { return path.resolve(p); }

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
      actionCommand.opts().checksum ??= dependency(name, {version: actionCommand.opts().version}).checksum;
    });
  }

  if (cmakeBuildType) {
    cmd.option('--cmake-build-type <value>', 'Overrides CMAKE_BUILD_TYPE.', 'Release');
  }

  return cmd;
}

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
    actionCommand.opts().withGlfw ??= dependency('glfw').root(actionCommand.opts().directory);
  })
  .option('--with-capstone <directory>', 'Root directory of capstone (location of lib/pkgconfig/capstone.pc).')
  .hook('preAction', (thisCommand, actionCommand) => {
    actionCommand.opts().withCapstone ??= dependency('capstone').root(actionCommand.opts().directory);
  })
  .action((options) => steps(options).fetch_tracy(options));

FetchCommand('google-benchmark', {version: true, suffix: true, checksum: true, cmakeBuildType: true})
  .action((options) => steps(options).fetch_google_benchmark(options));

program
  .command('setup')
  .description('Fetch dependencies.')
  .option('-C, --directory <directory>', 'Change to DIR before performing any operations.', absolute_path,
          __dirname === process.cwd() ? path.join(process.cwd(), 'vendor') : process.cwd())
  .option('-q, --quiet', 'Hide non-essential messages (e.g. only display external commands output if they fail).')
  .action(async (options) => {
    const directory = options.directory;
    await steps(options).fetch_ittapi({directory, cmakeBuildType: 'Release'});
    await steps(options).fetch_tracy({directory, components: ['lib']});
    await steps(options).fetch_google_benchmark({directory, cmakeBuildType: 'Release'});
  });

function start_ci_container(options) {
  const branch = execa.sync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.toString();

  execa.sync('docker', ['volume', 'create', 'instrmt-build-cache']);

  const step_exe = options.quiet ? `step -q` : `step`;

  const commands = [
    `${step_exe} git clone --depth 1 -b ${branch} /repo /src`,
    `${step_exe} mkdir -p /cache/node_modules /cache/vendor`,
    `${step_exe} ln -snf /cache/vendor /src/vendor`,
    // npm does not allow node_modules to be a symlink, use rsync to synchronize it instead.
    `${step_exe} rsync -a /cache/node_modules/ /src/node_modules/`,
    `${step_exe} npm i --production --prefer-offline --no-audit --progress=false`,
    `${step_exe} rsync -a /src/node_modules/ /cache/node_modules/`,
    shellquote.quote([
      'step', 'node', 'bootstrap.js', 'ci', // Not step -q otherwise there would be no output
      ...dargs(options, {includes: ['quiet'], ignoreFalse: true}),
      ...dargs(options, {includes: ['werror'], ignoreTrue: true}),
      ...dargs(options, {includes: ['compiler', 'cmakeVersion', 'ittapiVersion', 'tracyVersion', 'googleBenchmarkVersion']}),
    ])
  ];

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

function valid_compiler(c) {
  if (c.match(/(?:gcc|clang)(?:-\d+)?$/))
    return c;
  throw new commander.InvalidArgumentError('Not a valid compiler.');
}

function prependPath(...values) {
  process.env.PATH = values.concat((process.env.PATH || '').split(path.delimiter).filter(e => e)).join(path.delimiter);
}

program
  .command('ci')
  .option('--docker', 'Run on a fresh clone in a docker container')
  .option('--shell', 'Keep shell open at the end.')
  .option('-c, --compiler <name>', 'Compiler to use.', valid_compiler)
  .option('--ittapi-version <version>', 'Version of ITT API to use.')
  .option('--tracy-version <version>', 'Version of Tracy to use.')
  .option('--google-benchmark-version <version>', 'Version of Google Benchmark')
  .option('--cmake-version <version>', 'Version of CMake to use.')
  .option('--no-werror', 'Do not build with -Werror.')
  .option('-q, --quiet', 'Hide non-essential messages (e.g. only display external commands output if they fail).')
  .action(async (options) => {
    if (options.docker) {
      return start_ci_container(options);
    }

    return step({
      title: 'CI',
      action: async () => {
        const ittapi = await steps(options).fetch_ittapi({version: options.ittapiVersion});
        const tracy = await steps(options).fetch_tracy({version: options.tracyVersion, components: ['lib']});
        const google_benchmark = await steps(options).fetch_google_benchmark({version: options.googleBenchmarkVersion});

        if (options.cmakeVersion) {
          const cmake3 = await steps(options).fetch_cmake3({version: options.cmakeVersion === true ? dependency('cmake3').version : options.cmakeVersion});
          prependPath(path.join(cmake3.root, 'bin'));
        }

        await steps(options).withTempdir(path.join(os.tmpdir(), 'instrmt-'), async (tempdir) => {
          const instrmt_bld = path.join(tempdir, 'instrmt-build');
          const instrmt_dist = path.join(tempdir, 'instrmt-install');

          const cmake_compiler_options = options.compiler ? [`-DCMAKE_CXX_COMPILER=${options.compiler.replace('gcc', 'g++').replace('clang', 'clang++')}`] : [];

          await steps(options).execa(['cmake', '--version']);

          await steps(options).execa(
            cmake_configure_command(__dirname, instrmt_bld, {
              buildType: 'Release', installPrefix: instrmt_dist, args: [
                ...cmake_compiler_options,
                '-DINSTRMT_BUILD_ITT_ENGINE=ON', `-DVTUNE_ROOT=${ittapi.root}`,
                '-DINSTRMT_BUILD_TRACY_ENGINE=ON', `-DTRACY_ROOT=${tracy.root}`,
                '-DBUILD_BENCHMARKS=ON', `-Dbenchmark_DIR=${path.join(google_benchmark.root, 'lib', 'cmake', 'benchmark')}`,
                '-DBUILD_TESTING=ON', ...(options.werror ? ['-DCMAKE_CXX_FLAGS=-Werror'] : [])
              ]
            })
          );

          await steps(options).execa(cmake_build_command(instrmt_bld, {target: 'install'}));

          await steps(options).execa(['ctest'], {cwd: instrmt_bld});

          await steps(options).verify_instrmt_cmake_integration(tempdir, instrmt_bld, instrmt_dist, ittapi.root, tracy.root, {args: cmake_compiler_options});
        });
      }
    });
  });

program.parseAsync(process.argv)
  .catch(err => {
    console.error(err);
    process.exitCode = -1;
  });