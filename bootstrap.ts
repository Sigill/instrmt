// See https://github.com/gajus/global-agent for proxy configuration
import * as global_agent from 'global-agent';
global_agent.bootstrap();

import arrify from 'arrify';
import assert from 'assert';
import * as commander from 'commander';
import dargs from 'dargs';
import { execa, execaSync } from 'execa';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import glob from 'glob';
import got from 'got';
import isInteractive from 'is-interactive';
import which from 'which';
import hasha from 'hasha';
import os from 'os';
import path from 'path';
import pathIsInside from 'path-is-inside';
import { promisify } from 'util';
import replaceInFile, { ReplaceInFileConfig } from 'replace-in-file';
import rimraf from 'rimraf';
import semver from 'semver';
import shellquote from 'shell-quote';
import stream from 'stream';
import tar from 'tar';
import { ValueOrPromise } from 'value-or-promise';
import { step } from '@sigill/watch-your-step';
import * as si from 'systeminformation';

// https://techsparx.com/nodejs/esnext/dirname-es-modules.html
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const nproc = os.cpus().length;

const default_vendor_dir = __dirname === process.cwd() ? path.join(process.cwd(), 'vendor') : process.cwd();

function cmake_configure_command(src: string, bld: string, {cmake='cmake', buildType, installPrefix, args=[]}: {cmake?: string, buildType?: string, installPrefix?: string, args?: string | string[]} = {}) {
  const cmd = [cmake, '-S', src, '-B', bld];
  if (buildType)
    cmd.push(`-DCMAKE_BUILD_TYPE=${buildType}`);
  if (installPrefix)
    cmd.push(`-DCMAKE_INSTALL_PREFIX=${installPrefix}`);
  cmd.push(...arrify(args));
  return cmd;
}

function cmake_build_command(bld: string, {cmake='cmake', target}: {cmake?: string, target?: string} = {}) {
  const  cmd = [cmake, '--build', bld];
  if (target !== undefined)
    cmd.push('--target', target);
  cmd.push('-j', `${nproc}`);
  return cmd;
}

function install(files: string | string[], dir: string, {filename, base}: {filename?: string, base?: string} = {}) {
  files = arrify(files);
  assert(files.length > 0, 'No file to install');
  assert(filename === undefined || files.length === 1, 'Cannot use the "filename" option when installing multiple files');

  const finalPath = (f: string) => {
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
  new Set(final_paths).forEach(d => fs.mkdirSync(d, { recursive: true }));

  files.forEach(f => {
    fs.cpSync(f, finalPath(f), { preserveTimestamps: true });
  });
}

function sed(files: string | string[], from: ReplaceInFileConfig['from'], to: ReplaceInFileConfig['to']) {
  replaceInFile.sync({files, from, to})
    .filter(result => !result.hasChanged)
    .forEach(result => { throw new Error(`${result.file}: No match for ${from}`); });
}

function pretty_version(v: string) {
  const is_semver = v.match(/^v?(?:(\d+))(?:\.(\d+))?(\.\d+)?$/);
  if (!is_semver) return v;
  return semver.valid(semver.coerce(v));
}

function match_version(version: string, {tag = [], range}: {tag?: string | string[], range?: string} = {}) {
  version = pretty_version(version) || (() => { throw new Error('Not a version'); })();

  if (arrify(tag).includes(version))
    return true;

  if (range && semver.valid(version) && semver.satisfies(version, range)) {
    return true;
  }

  return false;
}

function isDirectory(p: string) {
  return fs.existsSync(p) && fs.lstatSync(p).isDirectory();
}

function unbuffer(command: string[]): [string, string[]] {
  if (which.sync('unbuffer')) {
    return ['unbuffer', command];
  } else {
    return [command[0], command.slice(1)];
  }
}

function pretty_command(command: string[], {env, cwd}: {env?: NodeJS.ProcessEnv, cwd?: string} = {}) {
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

const dependencies: {
  [k in 'cmake3' | 'ittapi' | 'capstone' | 'glfw' | 'tracy' | 'google-benchmark']: {
    basename?: string;
    default_version: string;
    versions: {
      [k: string]: { checksum: string; };
    }
  };
} = {
  cmake3: {
    basename: 'cmake',
    default_version: '3.23.2',
    versions: {
      '3.23.2': { checksum: 'sha256:aaced6f745b86ce853661a595bdac6c5314a60f8181b6912a0a4920acfa32708' }
    }
  },
  ittapi: {
    default_version: 'v3.23.0',
    versions: {
      'v3.23.0': { checksum: 'sha256:9af1231808c602c2f7a66924c8798b1741d3aa4b15f3874d82ca7a89b5dbb1b1' }
    }
  },
  capstone: {
    default_version: '4.0.2',
    versions: {
      '4.0.2': { checksum: 'md5:8894344c966a948f1248e66c91b53e2c' }
    }
  },
  glfw: {
    default_version: '3.3.6',
    versions: {
      '3.3.6': { checksum: 'sha256:ed07b90e334dcd39903e6288d90fa1ae0cf2d2119fec516cf743a0a404527c02' }
    }
  },
  tracy: {
    default_version: 'v0.8.1',
    versions: {
      'v0.7.2': { checksum: 'md5:bceb615c494c3f7ccb77ba3bae20b216' },
      'v0.7.6': { checksum: 'md5:828be21907a1bddf5762118cf9e3ff66' },
      'v0.8.1': { checksum: 'sha256:004992012b2dc879a9f6d143cbf94d7ea30e88135db3ef08951605d214892891' }
    }
  },
  'google-benchmark': {
    default_version: 'v1.6.1',
    versions: {
      'v1.6.1': { checksum: 'sha256:6132883bc8c9b0df5375b16ab520fac1a85dc9e4cf5be59480448ece74b278d4' }
    }
  }
};

function dependency(name: keyof typeof dependencies, {version, suffix, prefix = default_vendor_dir}: {version?: string, suffix?: string, prefix?: string} = {})
{
  version ||= dependencies[name].default_version;
  const basename = [dependencies[name].basename || name, pretty_version(version), suffix].filter(e => e).join('-');
  const root = path.join(prefix, basename);
  const checksum = dependencies[name].versions?.[version]?.checksum;

  return {
    basename, root, checksum, version,
    build_directories: function({ buildInSource = false, skipInstall = false }: { buildInSource?: boolean, skipInstall?: boolean } = {}) {
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

interface Context {
  quiet?: boolean;
}

function cleanup(files: string | string[]) {
  return step('Cleanup',
              () => arrify(files).forEach(e => rimraf.sync(e)));
}

function withTempdir<T>(prefix: string, action: (dir: string) => T) {
  const tempdir = fs.mkdtempSync(prefix);
  return new ValueOrPromise(() => action(tempdir))
    .then(args => { cleanup(tempdir); return args; }, (err) => { cleanup(tempdir); throw err; })
    .resolve() as T;
}

function execute(ctx: Context, command: string[], {title, skip, env, cwd}: {title?: string, skip?: () => boolean | string, env?: NodeJS.ProcessEnv, cwd?: string} = {}) {
  return step({
    title: title || pretty_command(command, {cwd, env}),
    skip,
    action: () => {
      const p = ctx.quiet
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
}

function download(ctx: Context, url: string, file: string) {
  const pipeline = promisify(stream.pipeline);
  return step({
    title: `Download ${url}`,
    skip: () => fs.existsSync(file) && (ctx.quiet || `${file} already exists`),
    action: () => fsp.mkdir(path.dirname(file), { recursive: true }).then(() => pipeline(got.stream(url), fs.createWriteStream(file)))
  });
}

function verifyChecksum(ctx: Context, file: string, expected_checksum: string) {
  return step({
    title: `Verify checksum of ${file}`,
    skip: () => !expected_checksum && (ctx.quiet || 'Checksum not specified'),
    action: async () => {
      const [algorithm, expected_hash] = expected_checksum.split(':', 2);
      const actual_hash = await hasha.fromFile(file, { algorithm });
      if (actual_hash !== expected_hash)
        throw new Error(`${algorithm}(${file}) = ${actual_hash} != ${expected_hash}`);
    }
  });
}

function extract(archive: string, dest: string, {strip_components}: {strip_components?: number} = {}) {
  return step(`Extract ${archive}`,
              () => fsp.mkdir(dest, { recursive: true }).then(() => tar.x({ file: archive, strip: strip_components, C: dest })));
}

async function download_and_extract(ctx: Context, url: string, archive: string, checksum: string, dest: string, {strip_components}: {strip_components?: number} = {}) {
  await download(ctx, url, archive);
  await verifyChecksum(ctx, archive, checksum);
  await extract(archive, dest, {strip_components});
}

async function fetch_cmake3(ctx: Context, {directory = default_vendor_dir, version, checksum}: {directory?: string, version?: string, checksum?: string} = {}) {
  const d = dependency('cmake3', {version, prefix: directory});
  const url = `https://github.com/Kitware/CMake/releases/download/v${d.version}/cmake-${d.version}-Linux-x86_64.tar.gz`;
  const archive = path.join(directory, `cmake-${d.version}-Linux-x86_64.tar.gz`);

  await step({
    title: 'Fetch CMake 3',
    skip: () => isDirectory(d.root) && (ctx.quiet || `${d.root} already exists`),
    action: async () => await download_and_extract(ctx, url, archive, checksum ?? d.checksum, d.root, {strip_components: 1})
  });

  return d;
}

async function fetch_ittapi(ctx: Context, {directory = default_vendor_dir, version, suffix, checksum, cmakeBuildType}: {directory?: string, version?: string, suffix?: string, checksum?: string, cmakeBuildType?: string} = {}) {
  const d = dependency('ittapi', {version, prefix: directory, suffix});
  const dirs = d.build_directories();
  const url = `https://github.com/intel/ittapi/archive/${d.version}.tar.gz`;
  const archive = path.join(directory, `ittapi-${d.version}.tar.gz`);

  await step({
    title: 'Fetch ittapi',
    skip: () => isDirectory(dirs.install) && (ctx.quiet || `${dirs.install} already exists`),
    action: async () => {
      await download_and_extract(ctx, url, archive, checksum ?? d.checksum, dirs.src, {strip_components: 1});
      await execute(ctx, cmake_configure_command(dirs.src, dirs.build, {buildType: cmakeBuildType, args: []})),
      await execute(ctx, cmake_build_command(dirs.build)),
      step('Install', () => {
        const headers = glob.sync(path.join(dirs.src, 'include', '**', '*.h?(pp)'));
        install(headers, path.join(dirs.install, 'include'), {base: path.join(dirs.src, 'include')});
        install(
          path.join(dirs.build, 'bin', 'libittnotify.a'),
          path.join(dirs.install, 'lib64')
        );
      });
      cleanup(dirs.temp);
    }
  });

  return d;
}

async function fetch_capstone(ctx: Context, {directory = default_vendor_dir, version, suffix, checksum, cmakeBuildType}: {directory?: string, version?: string, suffix?: string, checksum?: string, cmakeBuildType?: string} = {}) {
  const d = dependency('capstone', {version, prefix: directory, suffix});
  const dirs = d.build_directories();
  const url = `https://github.com/aquynh/capstone/archive/${d.version}.tar.gz`;
  const archive = path.join(directory, `capstone-${d.version}.tar.gz`);

  await step({
    title: 'Fetch capstone',
    skip: () => isDirectory(dirs.install) && (ctx.quiet || `${dirs.install} already exists`),
    action: async () => {
      await download_and_extract(ctx, url, archive, checksum ?? d.checksum, dirs.src, {strip_components: 1});
      await execute(ctx, cmake_configure_command(dirs.src, dirs.build, {buildType: cmakeBuildType, installPrefix: dirs.install, args: ['-DCAPSTONE_BUILD_TESTS=OFF']}));
      await execute(ctx, cmake_build_command(dirs.build, {target: 'install'}) );
      // To force the use of the static ones when building tracy's capture & profiler.
      step('Drop dynamic libraries', () => {
        glob.sync(path.join(dirs.install, 'lib', 'libcapstone.so*')).forEach(f => fs.rmSync(f));
      });
      cleanup(dirs.temp);
    }
  });

  return d;
}


async function fetch_glfw(ctx: Context, {directory = default_vendor_dir, version, suffix, checksum, cmakeBuildType}: {directory?: string, version?: string, suffix?: string, checksum?: string, cmakeBuildType?: string} = {}) {
  const d = dependency('glfw', {version, prefix: directory, suffix});
  const dirs = d.build_directories();
  const url = `https://github.com/glfw/glfw/archive/${d.version}.tar.gz`;
  const archive = path.join(directory, `glfw-${d.version}.tar.gz`);

  await step({
    title: 'Fetch glfw',
    skip: () => isDirectory(dirs.install) && (ctx.quiet || `${dirs.install} already exists`),
    action: async () => {
      await download_and_extract(ctx, url, archive, checksum ?? d.checksum, dirs.src, {strip_components: 1});
      await execute(ctx, cmake_configure_command(
        dirs.src, dirs.build,
        {
          buildType: cmakeBuildType, installPrefix: dirs.install,
          args: ['-DGLFW_BUILD_DOCS=OFF', '-DGLFW_BUILD_EXAMPLES=OFF', '-DGLFW_BUILD_TESTS=OFF']
        }
      ));
      await execute(ctx, cmake_build_command(dirs.build, {target: 'install'}));
      step('Fix pkgconfig file', () => {
        sed(path.join(dirs.install, 'lib/pkgconfig/glfw3.pc'), 'Requires.private:  x11', 'Requires:  x11');
      });
      cleanup(dirs.temp);
    }
  });

  return d;
}

async function fetch_tracy(ctx: Context, {directory = default_vendor_dir, version, suffix, checksum, components = [], withGlfw, withCapstone, fallbackTimer}: {directory?: string, version?: string, suffix?: string, checksum?: string, cmakeBuildType?: string, components?: string[], withGlfw?: string, withCapstone?: string, fallbackTimer?: boolean}) {
  const d = dependency('tracy', {version, prefix: directory, suffix});
  const dirs = d.build_directories({buildInSource: true});
  const url = `https://github.com/wolfpld/tracy/archive/${d.version}.tar.gz`;
  const archive = path.join(directory, `tracy-${d.version}.tar.gz`);

  const buildStep = async (directory: string, {extra_pc_dirs = [], skip}: {extra_pc_dirs?: string[], skip?: () => string | boolean} = {}) => {
    const env: NodeJS.ProcessEnv = {};
    if (extra_pc_dirs.length === 0) {
      env.PKG_CONFIG_PATH = extra_pc_dirs.concat((process.env.PKG_CONFIG_PATH || '').split(path.delimiter).filter(e => e)).join(path.delimiter);
    }

    return execute(ctx, ['make', '-C', directory, '-j', `${nproc}`, 'release'], {env, skip});
  };

  const installHeaders = (...subdirs: string[]) => {
    const files = glob.sync(path.join(dirs.src, ...subdirs, '*.h?(pp)'));
    install(files, path.join(dirs.install, 'include', ...subdirs));
  };

  const use_fallback_timer = await si.cpuFlags().then(flags => !flags.split(' ').includes('tsc_reliable'));

  await step({
    title: 'Fetch tracy',
    skip: () => isDirectory(dirs.install) && (ctx.quiet || `${dirs.install} already exists`),
    action: async () => {
      await download_and_extract(ctx, url, archive, checksum ?? d.checksum, dirs.src, {strip_components: 1});
      await execute(ctx, ['patch', '-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'tracy-pkgconfig-static.diff')],
                    {
                      skip: () => !match_version(d.version, {range: '>=0.7 <=0.7.2'}) && (ctx.quiet || `Not required for version ${d.version}`)
                    });
      step({
        title: `Fix includes`,
        skip: () => !match_version(d.version, {range: '<0.7.6'}) && (ctx.quiet || `Not required for version ${d.version}`),
        action: () => {
          ['TracyWorker.cpp', 'TracySourceView.cpp'].forEach(f => {
            sed(path.join(dirs.src, 'server', f), 'capstone/capstone.h', 'capstone.h');
          });
        }
      });
      step({
        title: `Enable legacy timers`,
        skip: () => !(fallbackTimer ?? use_fallback_timer) && (ctx.quiet || `Not enabled`),
        action: () => {
          sed(path.join(dirs.src, 'library/unix/build.mk'), 'DEFINES +=', 'DEFINES += -DTRACY_TIMER_FALLBACK');
        }
      });
      if (components.includes('lib')) {
        await step('Build library', async () => {
          const workdir = path.join(dirs.src, 'library', 'unix');
          await buildStep(workdir);
          step('Install library', () => {
            install(path.join(workdir, 'libtracy-release.so'), path.join(dirs.install, 'lib'), {filename: 'libtracy.so'});

            installHeaders();
            installHeaders('client');
            installHeaders('common');
          });
        });
      }
      if (components.includes('capture')) {
        await step('Build capture tool', async () => {
          const workdir = path.join(dirs.src, 'capture', 'build', 'unix');
          await buildStep(workdir, {extra_pc_dirs: [withCapstone].filter(e => e).map(d => path.join(d as string, 'lib', 'pkgconfig'))});
          step('Install capture', () => {
            install(path.join(workdir, 'capture-release'), path.join(dirs.install, 'bin'), {filename: 'capture'});
          });
        });
      }
      if (components.includes('profiler')) {
        await step('Build profiler', async () => {
          const workdir = path.join(dirs.src, 'profiler', 'build', 'unix');
          await buildStep(workdir, {extra_pc_dirs: [withCapstone, withGlfw].filter(e => e).map(d => path.join(d as string, 'lib', 'pkgconfig'))});
          step('Install profiler', () => {
            install(path.join(workdir, 'Tracy-release'), path.join(dirs.install, 'bin'), {filename: 'tracy'});
          });
        });
      }
      cleanup(dirs.temp);
    }
  });

  return d;
}

async function fetch_google_benchmark(ctx: Context, {directory = default_vendor_dir, version, suffix, checksum, cmakeBuildType}: {directory?: string, version?: string, suffix?: string, checksum?: string, cmakeBuildType?: string} = {}) {
  const d = dependency('google-benchmark', {version, prefix: directory, suffix});
  const dirs = d.build_directories({buildInSource: true});
  const url = `https://github.com/google/benchmark/archive/${d.version}.tar.gz`;
  const archive = path.join(directory, `google-benchmark-${d.version}.tar.gz`);

  await step({
    title: 'Fetch google-benchmark',
    skip: () => isDirectory(dirs.install) && (ctx.quiet || `${dirs.install} already exists`),
    action: async () => {
      await download_and_extract(ctx, url, archive, checksum ?? d.checksum, dirs.src, {strip_components: 1});
      await execute(ctx, cmake_configure_command(
        dirs.src, dirs.build,
        {buildType: cmakeBuildType, installPrefix: dirs.install, args: ['-DBENCHMARK_ENABLE_TESTING=OFF']})
      );
      await execute(ctx, cmake_build_command(dirs.build, {target: 'install'}));
      cleanup(dirs.temp);
    }
  });

  return d;
}

async function build_instmt_examples(ctx: Context, build_dir: string, instrmt_dir: string, ittapi_root: string, tracy_root: string, {cmake, args}: {cmake?: string, args?: string | string[]} = {}) {
  const configure_command = cmake_configure_command(
    path.join(__dirname, 'example'), build_dir,
    {
      cmake,
      args: [...(args || []), `-DInstrmt_DIR=${instrmt_dir}`, `-DVTUNE_ROOT=${ittapi_root}`, `-DTRACY_ROOT=${tracy_root}`]
    }
  );

  const build_command = cmake_build_command(build_dir, {cmake});

  await execute(ctx, configure_command);
  await execute(ctx, build_command);
}

async function verify_instrmt_cmake_integration(ctx: Context, workdir: string, instrmt_build_dir: string, instrmt_install_dir: string, ittapi_root: string, tracy_root: string, {cmake, args}: {cmake?: string, args?: string | string[]} = {}) {
  const build_examples = (build_dir: string, instrmt_dir: string) =>
    build_instmt_examples(ctx,
                          path.join(workdir, build_dir),
                          instrmt_dir, ittapi_root, tracy_root,
                          {cmake, args}
    );

  await step('Check CMake build tree integration', () => build_examples('example-from-build', instrmt_build_dir));
  await step('Check CMake install tree integration', () => build_examples('example-from-install', path.join(instrmt_install_dir, 'share', 'cmake', 'instrmt')));
}

function absolute_path(p: string) { return path.resolve(p); }

function ensureChecksum(value: string) {
  if (['md5', 'sha1', 'sha256', 'sha512'].some(a => value.startsWith(`${a}:`)))
    return value;
  throw new commander.InvalidArgumentError(`Invalid checksum syntax`);
}

const program = new commander.Command();

function FetchCommand(name: keyof typeof dependencies, {pretty_name, version, suffix, checksum, cmakeBuildType}: {pretty_name?: string, version?: boolean, suffix?: boolean, checksum?: boolean, cmakeBuildType?: boolean} = {}) {
  const cmd = program
    .command(`fetch-${name}`)
    .description(`Fetch ${pretty_name || name}.`)
    .option('-C, --directory <directory>', 'Change to DIR before performing any operations.', absolute_path, default_vendor_dir)
    .option('-q, --quiet', 'Hide non-essential messages (e.g. only display external commands output if they fail).');

  if (version) {
    cmd.option('-v, --version <value>', 'Overrides version.', dependency(name).version);
  }

  if (suffix) {
    cmd.option('-s, --suffix <value>', 'Suffix to append on directory name.');
  }

  if (checksum) {
    assert(version, '"checksum" option requires "version" option');

    cmd.option('-c, --checksum <value>', 'Overrides checksum.', ensureChecksum, undefined);
    cmd.hook('preAction', (_, actionCommand) => {
      actionCommand.opts().checksum ??= dependency(name, {version: actionCommand.opts().version}).checksum;
    });
  }

  if (cmakeBuildType) {
    cmd.option('--cmake-build-type <value>', 'Overrides CMAKE_BUILD_TYPE.', 'Release');
  }

  return cmd;
}

FetchCommand('cmake3', {pretty_name: 'CMake 3.x', version: true, checksum: true})
  .action(async (options) => {
    await fetch_cmake3(options, options);
  });

FetchCommand('ittapi', {pretty_name: 'ITT API', version: true, suffix: true, checksum: true, cmakeBuildType: true})
  .action(async (options) => {
    await fetch_ittapi(options, options);
  });

FetchCommand('capstone', {pretty_name: 'Capstone', version: true, suffix: true, checksum: true, cmakeBuildType: true})
  .action(async (options) => {
    await fetch_capstone(options, options);
  });

FetchCommand('glfw', {pretty_name: 'GLFW', version: true, suffix: true, checksum: true, cmakeBuildType: true})
  .action(async (options) => {
    await fetch_glfw(options, options);
  });

FetchCommand('tracy', {pretty_name: 'Tracy', version: true, suffix: true, checksum: true})
  .addOption(new commander.Option('--components <value...>', 'Components to build.').choices(['lib', 'capture', 'profiler']).default(['lib']))
  .option('--with-glfw <directory>', 'Root directory of glfw (location of lib/pkgconfig/glfw3.pc).')
  .hook('preAction', (_, actionCommand) => {
    actionCommand.opts().withGlfw ??= dependency('glfw', {prefix: actionCommand.opts().directory}).root;
  })
  .option('--with-capstone <directory>', 'Root directory of capstone (location of lib/pkgconfig/capstone.pc).')
  .hook('preAction', (_, actionCommand) => {
    actionCommand.opts().withCapstone ??= dependency('capstone', {prefix: actionCommand.opts().directory}).root;
  })
  .option('--fallback-timer', 'Use fallback timer, for hardware with no invariant TSC support (tracy >= 0.8).')
  .action(async (options) => {
    await fetch_tracy(options, options);
  });

FetchCommand('google-benchmark', {version: true, suffix: true, checksum: true, cmakeBuildType: true})
  .action(async (options) => {
    await fetch_google_benchmark(options, options);
  });

program
  .command('setup')
  .description('Fetch dependencies.')
  .option('-C, --directory <directory>', 'Change to DIR before performing any operations.', absolute_path, default_vendor_dir)
  .option('-q, --quiet', 'Hide non-essential messages (e.g. only display external commands output if they fail).')
  .action(async (options) => {
    const directory = options.directory;
    await fetch_ittapi(options, {directory, cmakeBuildType: 'Release'});
    await fetch_tracy(options, {directory, components: ['lib']});
    await fetch_google_benchmark(options, {directory, cmakeBuildType: 'Release'});
  });

function* yield_if(cond: boolean, ...elements: any[]) {
  if (cond) yield* elements;
}

async function start_ci_container(options: any): Promise<void> {
  const branch = execaSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.toString();

  execaSync('docker', ['volume', 'create', 'instrmt-build-cache']);

  const step_exe = options.quiet ? `step -q` : `step`;

  let commands = [
    `${step_exe} git config --global --add safe.directory /repo/.git`,
    `${step_exe} git clone --depth 1 -b ${branch} /repo /src`,
    ...yield_if(options.dockerCache,
                `${step_exe} mkdir -p /cache/node_modules /cache/vendor`,
                `${step_exe} ln -snf /cache/vendor /src/vendor`,
                // npm does not allow node_modules to be a symlink, use rsync to synchronize it instead.
                `${step_exe} rsync -a /cache/node_modules/ /src/node_modules/`),
    `${step_exe} npm i --prefer-offline --no-audit --progress=false`,
    ...yield_if(options.dockerCache,
                `${step_exe} rsync -a /src/node_modules/ /cache/node_modules/`),
    shellquote.quote([
      'step', 'npm', 'run', 'bootstrap', '--', 'ci', // Not step -q otherwise there would be no output
      ...dargs(options, {includes: ['quiet'], ignoreFalse: true}),
      ...dargs(options, {includes: ['werror'], ignoreTrue: true}),
      ...dargs(options, {includes: ['compiler', 'cmakeVersion', 'ittapiVersion', 'tracyVersion', 'googleBenchmarkVersion']}),
    ])
  ].join(' && ');

  if (options.shell) {
    if (!isInteractive())
      throw new Error('Host terminal is not a TTY, the --shell option cannot be used.');
    commands = `${commands} ; bash`;
  }

  const docker_command = [
    'docker', 'run', '--rm', '-v', `${__dirname}:/repo:ro`,
    ...yield_if(options.shell, '-i'), ...yield_if(options.shell || isInteractive(), '-t'),
    ...(options.dockerCache ? ['--mount', 'source=instrmt-build-cache,target=/cache'] : []),
    'instrmt-build',
    'bash', '-c', commands
  ];

  await step(shellquote.quote(docker_command),
             () => execa(docker_command[0], docker_command.slice(1), {stdio: 'inherit'})
               .catch(err => { throw new Error(`Command failed with exit code ${err.exitCode}`); })
  );
}

function valid_compiler(c: string) {
  if (c.match(/(?:gcc|clang)(?:-\d+)?$/))
    return c;
  throw new commander.InvalidArgumentError('Not a valid compiler.');
}

function prependPath(...values: string[]) {
  process.env.PATH = values.concat((process.env.PATH || '').split(path.delimiter).filter(e => e)).join(path.delimiter);
}

program
  .command('ci')
  .option('--docker', 'Run on a fresh clone in a docker container.')
  .option('--no-docker-cache', 'Do not use docker volume for cache.')
  .option('--shell', 'Keep shell open at the end.')
  .option('-c, --compiler <name>', 'Compiler to use.', valid_compiler)
  .option('--ittapi-version <version>', 'Version of ITT API to use.')
  .option('--tracy-version <version>', 'Version of Tracy to use.')
  .option('--google-benchmark-version <version>', 'Version of Google Benchmark to use.')
  .option('--cmake-version [version]', 'Version of CMake to use (default: use system version).')
  .option('--no-werror', 'Do not build with -Werror.')
  .option('-q, --quiet', 'Hide non-essential messages (e.g. only display external commands output if they fail).')
  .action(async (options): Promise<void> => {
    if (options.docker) {
      return start_ci_container(options);
    }

    return step('CI', async () => {
      const ittapi = await fetch_ittapi(options, {version: options.ittapiVersion});
      const tracy = await fetch_tracy(options, {version: options.tracyVersion, components: ['lib']});
      const google_benchmark = await fetch_google_benchmark(options, {version: options.googleBenchmarkVersion});

      if (options.cmakeVersion) {
        const cmake3 = await fetch_cmake3(options, {version: options.cmakeVersion === true ? dependency('cmake3').version : options.cmakeVersion});
        prependPath(path.join(cmake3.root, 'bin'));
      }

      await execute(options, ['cmake', '--version']);

      await withTempdir(path.join(os.tmpdir(), 'instrmt-'), async (tempdir) => {
        const instrmt_bld = path.join(tempdir, 'instrmt-build');
        const instrmt_dist = path.join(tempdir, 'instrmt-install');

        const cmake_compiler_options = options.compiler ? [`-DCMAKE_CXX_COMPILER=${options.compiler.replace('gcc', 'g++').replace('clang', 'clang++')}`] : [];

        await execute(options, cmake_configure_command(__dirname, instrmt_bld, {
          buildType: 'Release', installPrefix: instrmt_dist, args: [
            ...cmake_compiler_options,
            '-DINSTRMT_BUILD_ITT_ENGINE=ON', `-DVTUNE_ROOT=${ittapi.root}`,
            '-DINSTRMT_BUILD_TRACY_ENGINE=ON', `-DTRACY_ROOT=${tracy.root}`,
            '-DBUILD_BENCHMARKS=ON', `-Dbenchmark_DIR=${path.join(google_benchmark.root, 'lib', 'cmake', 'benchmark')}`,
            '-DBUILD_TESTING=ON', ...(options.werror ? ['-DCMAKE_CXX_FLAGS=-Werror'] : [])
          ]
        }));

        await execute(options, cmake_build_command(instrmt_bld, {target: 'install'}));

        await execute(options, ['ctest', '--output-on-failure'], {cwd: instrmt_bld});

        await verify_instrmt_cmake_integration(options, tempdir, instrmt_bld, instrmt_dist, ittapi.root, tracy.root, {args: cmake_compiler_options});
      });
    });
  });

program.parseAsync(process.argv)
  .catch(err => {
    console.error(err);
    process.exitCode = -1;
  });
