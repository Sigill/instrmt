#!/usr/bin/env node
"use strict;";

const assert = require('assert');
const crypto = require('crypto');
const execa = require('execa');
const fs = require('fs');
const fse = require('fs-extra');
const glob = require('glob');
const hasbin = require('hasbin');
const {Listr} = require('listr2');
const https = require('follow-redirects').https;
const mkdirp = require('mkdirp');
const os = require('os');
const {paramCase} = require('param-case');
const path = require('path');
const pathIsInside = require('path-is-inside');
const replaceInFile = require('replace-in-file');
const rimraf = require('rimraf');
const semver = require('semver');
const shellquote = require('shell-quote');
const tar = require('tar');
const commander = require('commander');

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

async function md5sum(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(file);
    stream.on('error', err => reject(err));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    const request = https.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
      } else {
        reject('Response status was ' + response.statusCode);
      }
    });

    file.on('finish', () => {
      file.close(err => {
        if (err)
          reject(err);
        else
          resolve(dest);
      });
    });

    request.on('error', (err) => {
      rimraf.sync(dest);
      reject(err.message);
    });

    file.on('error', (err) => {
      rimraf.sync(dest);
      reject(err.message);
    });
  });
}

function nproc() { return os.cpus().length; }

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
  cmd.push('-j', `${nproc()}`);
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
  let cv = semver.clean(v);
  return cv ? cv : v;
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

function execa_task_promise(command, {quiet=false, env, cwd} = {}) {
  assert(Array.isArray(command) && command.length > 0, 'Command is not a valid array');

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

function execa_task(command, {title, skip, enabled, env, cwd, pre, post} = {}) {
  return {
    title: title || shellquote.quote(command),
    skip,
    enabled,
    task: (ctx, task) => {
      const f = () => execa_task_promise(command, {quiet: ctx.quiet, env, cwd});

      let chain = pre
        ? new Promise( resolve => resolve(pre(ctx, task)) ).then(f)
        : f();
      if (post)
        chain = chain.then(() => post(ctx, task));
      return chain;
    }
  };
}

function download_task(url, file) {
  return {
    title: `Download ${url}`,
    skip: (ctx) => fs.existsSync(file) && (ctx.quiet || `${file} already exists`),
    task: () => mkdirp(path.dirname(file)).then(() => download(url, file))
  };
}

function checksum_task(file, expected_checksum) {
  return {
    title: `Verify checksum of ${file}`,
    skip: (ctx) => !expected_checksum && (ctx.quiet || 'Checksum not specified'),
    task: () => md5sum(file).then(actual_checksum => {
      if (actual_checksum !== expected_checksum)
        throw new Error(`md5(${file}) = ${actual_checksum} != ${expected_checksum}`);
    })
  };
}

function extract_task(archive, dest, {strip_components} = {}) {
  return {
    title: `Extract ${archive}`,
    task: () => mkdirp(dest).then(() => tar.x({ file: archive, strip: strip_components, C: dest }))
  };
}

function download_and_extract_tasks(url, archive, checksum, dest, {strip_components} = {}) {
  return [
    download_task(url, archive),
    checksum_task(archive, checksum),
    extract_task(archive, dest, {strip_components})
  ];
}

function cleanup_task(files) {
  return {
    title: 'Cleanup',
    task: () => files.forEach(e => rimraf.sync(e))
  };
}

function fetch_cmake28_task({directory = requiredArg('directory')} = {}) {
  const dirs = resolve_directories('cmake-2.8.12', directory);
  const url = 'https://github.com/Kitware/CMake/archive/v2.8.12.tar.gz';
  const archive = path.join(directory, 'cmake-2.8.12.tar.gz');

  return {
    title: 'Fetch CMake 2.8.12',
    skip: (ctx) => isDirectory(dirs.install) && (ctx.quiet || `${dirs.install} already exists`),
    task: (ctx, task) => {
      const tasks = [
        ...download_and_extract_tasks(url, archive, '0dc2118e56f5c02dc5a90be9bd19befc', dirs.src, {strip_components: 1}),
        execa_task(['patch', '-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'cmake2812-noqt.diff')]),
        execa_task(
          [path.join(dirs.src, 'bootstrap'), `--parallel=${nproc()}`, '--no-qt-gui', `--prefix=${dirs.install}`],
          {cwd: dirs.build, pre: () => mkdirp(dirs.build)}
        ),
        execa_task(['make', '-C', dirs.build, `-j${nproc()}`, 'install']),
        cleanup_task(dirs.temp)
      ];

      return task.newListr(tasks);
    }
  };
}

function fetch_cmake3_task({directory = requiredArg('directory'), version = requiredArg('version'), checksum} = {}) {
  const dirs = {install: path.join(directory, `cmake-${version}`)};
  const url = `https://github.com/Kitware/CMake/releases/download/v${version}/cmake-${version}-Linux-x86_64.tar.gz`;
  const archive = path.join(directory, `cmake-${version}-Linux-x86_64.tar.gz`);

  return {
    title: 'Fetch CMake 3',
    skip: (ctx) => isDirectory(dirs.install) && (ctx.quiet || `${dirs.install} already exists`),
    task: (ctx, task) => task.newListr(
      download_and_extract_tasks(url, archive, checksum, dirs.install, {strip_components: 1})
    )
  };
}

function fetch_ittapi_task({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType} = {}) {
  const dirs = resolve_directories(dependency('ittapi', version).basename(suffix), directory);
  const url = `https://github.com/intel/ittapi/archive/${version}.tar.gz`;
  const archive = path.join(directory, `ittapi-${version}.tar.gz`);

  return {
    title: 'Fetch ittapi',
    skip: (ctx) => isDirectory(dirs.install) && (ctx.quiet || `${dirs.install} already exists`),
    task: (ctx, task) => {
      const tasks = [
        ...download_and_extract_tasks(url, archive, checksum, dirs.src, {strip_components: 1}),
        execa_task(
          cmake_configure_command(dirs.src, dirs.build, {cmakeBuildType, args: []}),
          {pre: () => mkdirp(dirs.build)}
        ),
        execa_task(cmake_build_command(dirs.build)),
        {
          title: 'Install',
          task: () => {
            const headers = glob.sync(path.join(dirs.src, 'include', '**', '*.h?(pp)'));
            install(headers, path.join(dirs.install, 'include'), {base: path.join(dirs.src, 'include')});
            install(
              path.join(dirs.build, 'bin', 'libittnotify.a'),
              path.join(dirs.install, 'lib64')
            );
          }
        },
        cleanup_task(dirs.temp)
      ];

      return task.newListr(tasks);
    }
  };
}

function fetch_capstone_task({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType} = {}) {
  const dirs = resolve_directories(dependency('capstone', version).basename(suffix), directory);
  const url = `https://github.com/aquynh/capstone/archive/${version}.tar.gz`;
  const archive = path.join(directory, `capstone-${version}.tar.gz`);

  return {
    title: 'Fetch capstone',
    skip: (ctx) => isDirectory(dirs.install) && (ctx.quiet || `${dirs.install} already exists`),
    task: (ctx, task) => {
      const tasks = [
        ...download_and_extract_tasks(url, archive, checksum, dirs.src, {strip_components: 1}),
        execa_task(['patch', '-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'capstone-pkgconfig-includedir.diff')]),
        execa_task(
          cmake_configure_command(dirs.src, dirs.build, {cmakeBuildType, installPrefix: dirs.install, args: ['-DCAPSTONE_BUILD_TESTS=OFF', '-DCAPSTONE_BUILD_SHARED=OFF']}),
          {pre: () => mkdirp(dirs.build)}
        ),
        execa_task(cmake_build_command(dirs.build, {target: 'install'})),
        cleanup_task(dirs.temp)
      ];

      return task.newListr(tasks);
    }
  };
}

function fetch_glfw_task({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType} = {}) {
  const dirs = resolve_directories(dependency('glfw', version).basename(suffix), directory);
  const url = `https://github.com/glfw/glfw/archive/${version}.tar.gz`;
  const archive = path.join(directory, `glfw-${version}.tar.gz`);

  return {
    title: 'Fetch glfw',
    skip: (ctx) => isDirectory(dirs.install) && (ctx.quiet || `${dirs.install} already exists`),
    task: (ctx, task) => {
      const tasks = [
        ...download_and_extract_tasks(url, archive, checksum, dirs.src, {strip_components: 1}),
        execa_task(
          cmake_configure_command(
            dirs.src, dirs.build,
            {
              cmakeBuildType, installPrefix: dirs.install,
              args: ['-DGLFW_BUILD_DOCS=OFF', '-DGLFW_BUILD_EXAMPLES=OFF', '-DGLFW_BUILD_TESTS=OFF']
            }
          ),
          {pre: () => mkdirp(dirs.build)}
        ),
        execa_task(cmake_build_command(dirs.build, {target: 'install'})),
        {
          title: 'Fix pkgconfig file',
          task: () => sed(path.join(dirs.install, 'lib/pkgconfig/glfw3.pc'), 'Requires.private:  x11', 'Requires:  x11')
        },
        cleanup_task(dirs.temp)
      ];

      return task.newListr(tasks);
    }
  };
}

function fetch_tracy_task({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, components, withGlfw, withCapstone} = {}) {
  const dirs = resolve_directories(dependency('tracy', version).basename(suffix), directory, {buildInSource: true});
  const url = `https://github.com/wolfpld/tracy/archive/${version}.tar.gz`;
  const archive = path.join(directory, `tracy-${version}.tar.gz`);

  const buildTask = (directory, {extra_pc_dirs = [], skip, enabled} = {}) => {
    const PKG_CONFIG_PATH = extra_pc_dirs.concat((process.env.PKG_CONFIG_PATH || '').split(path.delimiter).filter(e => e)).join(path.delimiter);
    const env = Object.assign({}, process.env, {PKG_CONFIG_PATH});
    return execa_task(['make', '-C', directory, '-j', `${nproc()}`, 'release'], {env, skip, enabled});
  };

  const installHeaders = (...subdirs) => {
    const files = glob.sync(path.join(dirs.src, ...subdirs, '*.h?(pp)'));
    install(files, path.join(dirs.install, 'include', ...subdirs));
  };

  return {
    title: 'Fetch tracy',
    skip: (ctx) => isDirectory(dirs.install) && (ctx.quiet || `${dirs.install} already exists`),
    task: (ctx, task) => {
      const tasks = [
        ...download_and_extract_tasks(url, archive, checksum, dirs.src, {strip_components: 1})
      ];

      if (semver.ltr(version, '0.7.2')) {
        tasks.push(
          execa_task(['patch', '-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'tracy-pkgconfig-static.diff')])
        );
      }

      if (version === 'master' || semver.gte(version, '0.7.6')) {
        tasks.push({
          title: `Fix includes`,
          task: () => {
            ['TracyWorker.cpp', 'TracySourceView.cpp'].forEach(f => {
              sed(path.join(dirs.src, 'server', f), 'capstone.h', 'capstone/capstone.h');
            });
          }
        });
      }

      if (components.includes('lib')) {
        const workdir = path.join(dirs.src, 'library', 'unix');
        tasks.push(
          buildTask(workdir),
          {
            title: 'Install library',
            task: () => {
              install(path.join(workdir, 'libtracy-release.so'), path.join(dirs.install, 'lib'), {filename: 'libtracy.so'});

              installHeaders();
              installHeaders('client');
              installHeaders('common');
            }
          }
        );
      }

      if (components.includes('capture')) {
        const workdir = path.join(dirs.src, 'capture', 'build', 'unix');
        tasks.push(
          buildTask(workdir, {extra_pc_dirs: [withCapstone].filter(e => e).map(d => path.join(d, 'lib', 'pkgconfig'))}),
          {
            title: 'Install capture',
            task: () => {
              install(path.join(workdir, 'capture-release'), path.join(dirs.install, 'bin'), {filename: 'capture'});
            }
          }
        );
      }

      if (components.includes('profiler')) {
        const workdir = path.join(dirs.src, 'profiler', 'build', 'unix');
        tasks.push(
          buildTask(workdir, {extra_pc_dirs: [withCapstone, withGlfw].filter(e => e).map(d => path.join(d, 'lib', 'pkgconfig'))}),
          {
            title: 'Install profiler',
            task: () => {
              install(path.join(workdir, 'Tracy-release'), path.join(dirs.install, 'bin'), {filename: 'tracy'});
            }
          }
        );
      }

      tasks.push(cleanup_task(dirs.temp));

      return task.newListr(tasks);
    }
  };
}

function fetch_google_benchmark_task({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType} = {}) {
  const dirs = resolve_directories(dependency('google-benchmark', version).basename(suffix), directory);
  const url = `https://github.com/google/benchmark/archive/${version}.tar.gz`;
  const archive = path.join(directory, `google-benchmark-${version}.tar.gz`);

  return {
    title: 'Fetch google-benchmark',
    skip: (ctx) => isDirectory(dirs.install) && (ctx.quiet || `${dirs.install} already exists`),
    task: (ctx, task) => {
      const tasks = [
        ...download_and_extract_tasks(url, archive, checksum, dirs.src, {strip_components: 1}),
        execa_task(
          cmake_configure_command(dirs.src, dirs.build,
                                  {cmakeBuildType, installPrefix: dirs.install, args: ['-DBENCHMARK_ENABLE_TESTING=OFF']}),
          {pre: () => mkdirp(dirs.build)}
        ),
        execa_task(cmake_build_command(dirs.build, {target: 'install'})),
        cleanup_task(dirs.temp)
      ];

      return task.newListr(tasks);
    }
  };
}

function run_tasks(tasks, {quiet} = {}) {
  return new Listr(tasks, {renderer: 'verbose', rendererOptions: {showTimer: true, logEmptyTitle: false}}).run({quiet});
}

function absolute_path(p) { return path.resolve(p); }

const dependencies = {
  cmake3: {
    basename: 'cmake',
    default_version: '3.20.0',
    '3.20.0': { checksum: '9775844c038dd0b2ed80bce4747ba6bf' }
  },
  ittapi: {
    default_version: '8cd2618',
    '8cd2618': { checksum: '5920c512a7a7c8971f2ffe6f693ffff3' }
  },
  capstone: {
    default_version: '4.0.2',
    '4.0.2': { checksum: '8894344c966a948f1248e66c91b53e2c' }
  },
  glfw: {
    default_version: '3.3.4',
    '3.3.4': { checksum: '8f8e5e931ef61c6a8e82199aabffe65a' }
  },
  tracy: {
    default_version: 'v0.7.6',
    'v0.7.2': { checksum: 'bceb615c494c3f7ccb77ba3bae20b216' },
    'v0.7.6': { checksum: '828be21907a1bddf5762118cf9e3ff66' }
  },
  'google-benchmark': {
    default_version: 'v1.5.3',
    'v1.5.3': { checksum: 'abb43ef7784eaf0f7a98aed560920f46' }
  }
};

function dependency(name, version) {
  assert(dependencies[name], 'Unknown dependency');
  version ||= dependencies[name].default_version;

  return {
    basename: function(suffix) {
      return [dependencies[name].basename || name, pretty_version(version), suffix].filter(e => e).join('-');
    },
    path: function(prefix = path.join(__dirname, 'vendor')) {
      return path.join(prefix, this.basename());
    },
    checksum: function() {
      return dependencies[name]?.[version]?.checksum;
    },
    version: function() {
      return version;
    }
  };
}

const program = new commander.Command();

class FetchCommand {
  constructor(name, pretty_name) {
    this.name = name;

    this.optionsPostProcessors = [];

    this.cmd = program
      .command(`fetch-${this.name}`)
      .description(`Fetch ${pretty_name || name}.`)
      .option('-C, --directory <directory>', 'Change to DIR before performing any operations.', absolute_path,
              __dirname === process.cwd() ? path.join(process.cwd(), 'vendor') : process.cwd())
      .option('-q, --quiet', 'Hide non-essential messages (e.g. only display external commands output if they fail).');
  }

  optionsPostProcessor(fn) { this.optionsPostProcessors.push(fn); return this;}

  versionOption() {
    this.cmd.option('-v, --version <value>', 'Overrides version.', dependency(this.name).version());
    return this;
  }

  suffixOption() {
    this.cmd.option('-s, --suffix <value>', 'Suffix to append on directory name.');
    return this;
  }

  checksumOption() {
    this.cmd.option('-c, --checksum <value>', 'Overrides checksum.');
    this.optionsPostProcessor((options) => { options.checksum ??= dependency(this.name, options.version).checksum(); });
    return this;
  }

  cmakeBuildtypeOption() {
    this.cmd.option('--cmake-build-type <value>', 'Overrides CMAKE_BUILD_TYPE.', 'Release');
    return this;
  }

  option(...args) { this.cmd.option(...args); return this; }

  addOption(opt) { this.cmd.addOption(opt); return this; }

  action(fn) {
    this.cmd.action(async (options) => {
      this.optionsPostProcessors.forEach(p => p(options));
      await fn(options);
    });
  }
}

new FetchCommand('cmake28', 'CMake 2.8.12')
  .action((options) => run_tasks(fetch_cmake28_task(options), options));

new FetchCommand('cmake3', 'CMake 3.x')
  .versionOption()
  .checksumOption()
  .action((options) => run_tasks(fetch_cmake3_task(options), options));

new FetchCommand('ittapi', 'ITT API')
  .versionOption()
  .suffixOption()
  .checksumOption()
  .cmakeBuildtypeOption()
  .action((options) => run_tasks(fetch_ittapi_task(options), options));

new FetchCommand('capstone', 'Capstone')
  .versionOption()
  .suffixOption()
  .checksumOption()
  .cmakeBuildtypeOption()
  .action((options) => run_tasks(fetch_capstone_task(options), options));

new FetchCommand('glfw', 'GLFW')
  .versionOption()
  .suffixOption()
  .checksumOption()
  .cmakeBuildtypeOption()
  .action((options) => run_tasks(fetch_glfw_task(options), options));

new FetchCommand('tracy', 'Tracy')
  .versionOption()
  .suffixOption()
  .checksumOption()
  .addOption(new commander.Option('--components <value...>', 'Components to build.').choices(['lib', 'capture', 'profiler']).default(['lib']))
  .option('--with-glfw <directory>', 'Root directory of glfw (location of lib/pkgconfig/glfw3.pc).')
  .optionsPostProcessor((options) => { options.withGlfw ??= dependency('glfw').path(options.directory); })
  .option('--with-capstone <directory>', 'Root directory of capstone (location of lib/pkgconfig/capstone.pc).')
  .optionsPostProcessor((options) => { options.withCapstone ??= dependency('capstone').path(options.directory); })
  .action((options) => run_tasks(fetch_tracy_task(options), options));

new FetchCommand('google-benchmark')
  .versionOption()
  .suffixOption()
  .checksumOption()
  .cmakeBuildtypeOption()
  .action((options) => run_tasks(fetch_google_benchmark_task(options), options));

program
  .command('fetch-dependencies')
  .description('Download and build dependencies.')
  .option('-C, --directory <directory>', 'Change to DIR before performing any operations.', absolute_path,
          __dirname === process.cwd() ? path.join(process.cwd(), 'vendor') : process.cwd())
  .option('-q, --quiet', 'Hide non-essential messages (e.g. only display external commands output if they fail).')
  .action(async (options) => run_tasks([
    fetch_ittapi_task({
      directory: options.directory,
      version: dependency('ittapi').version(),
      checksum: dependency('ittapi').checksum()
    }),
    fetch_tracy_task({
      directory: options.directory,
      version: dependency('tracy').version(),
      checksum: dependency('tracy').checksum(),
      components: ['lib']
    }),
    fetch_google_benchmark_task({
      directory: options.directory,
      version: dependency('google-benchmark').version(),
      checksum: dependency('google-benchmark').checksum()
    })
  ], options));

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

function instrmt_configure_build_tasks(buildDir, {cmake, buildType, installPrefix, ittapi, tracy, googleBenchmark, enableTests=true, cmakeArgs = [], build}) {
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

  const tasks = [
    execa_task(configure_command)
  ];

  if (build) {
    const build_command = cmake_build_command(buildDir, {target: build === true ? undefined : build});
    tasks.push(
      execa_task(build_command)
    );
  }

  return tasks;
}

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
  .action((options, command) => run_tasks(
    instrmt_configure_build_tasks(
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
    ),
    options
  ));

function instrmt_build_example_tasks(instrmt_dir, build_dir, cmake, ittapi_root, tracy_root) {
  const configure_command = cmake_configure_command(
    path.join(__dirname, 'example'), build_dir,
    {
      buildType: 'Release',
      cmake,
      args: [`-DInstrmt_DIR=${instrmt_dir}`, `-DVTUNE_ROOT=${ittapi_root}`, `-DTRACY_ROOT=${tracy_root}`]
    }
  );

  const build_task = cmake_build_command(build_dir, {cmake});

  return [
    execa_task(configure_command),
    execa_task(build_task),
  ];
}

function cmake_integration_tasks(instrmt_build_dir, instrmt_install_dir, workdir, ittapi_root, tracy_root, {cmake} = {}) {
  return [
    {
      title: 'Use build tree',
      task: (ctx, task) => task.newListr(
        instrmt_build_example_tasks(
          instrmt_build_dir,
          path.join(workdir, 'example-from-build'),
          cmake, ittapi_root, tracy_root
        )
      )
    },
    {
      title: 'Use install tree',
      task: (ctx, task) => task.newListr(
        instrmt_build_example_tasks(
          path.join(instrmt_install_dir, 'share', 'cmake', 'instrmt'),
          path.join(workdir, 'example-from-install'),
          cmake, ittapi_root, tracy_root
        )
      )
    }
  ];
}

program
  .command('cmake-integration')
  .description('Run integration tests')
  .option('--ittapi-root <directory>', '', absolute_path, dependency('ittapi').path(path.join(__dirname, 'vendor')))
  .option('--tracy-root <directory>', '', absolute_path, dependency('tracy').path(path.join(__dirname, 'vendor')))
  .option('--cmake <file>', '', absolute_path, 'cmake')
  .option('-q, --quiet', 'Hide non-essential messages (e.g. only display external commands output if they fail).')
  .action((options) => run_tasks([
    {
      title: 'Create temporary directory',
      task: (ctx, task) => {
        task.output = ctx.temp = fs.mkdtempSync(path.join(os.tmpdir(), 'instrmt-it-'));
        ctx.instrmt_bld = path.join(ctx.temp, 'instrmt-build');
        ctx.instrmt_dist = path.join(ctx.temp, 'instrmt-install');
      }
    },
    {
      task: (ctx, task) => task.newListr(
        instrmt_configure_build_tasks(
          ctx.instrmt_bld,
          {
            buildType: 'Release',
            installPrefix: ctx.instrmt_dist,
            ittapi: options.ittapiRoot,
            tracy: options.tracyRoot,
            enableTests: false,
            build: 'install'
          }
        )
      )
    },
    {
      title: 'Verify CMake integration',
      task: (ctx, task) => task.newListr(
        cmake_integration_tasks(ctx.instrmt_bld, ctx.instrmt_dist, ctx.temp, options.ittapiRoot, options.tracyRoot, {cmake: options.cmake})
      )
    },
    {
      title: 'Cleanup',
      task: (ctx) => { rimraf.sync(ctx.temp); }
    }
  ], options));

function docker_volumes() {
  return execa.sync('docker', ['volume', 'ls']).stdout.split('\n').slice(1).map(l => l.split(/ +/)[1]);
}

function optgen(options) {
  return {
    unary: function* (...names) {
      for(const name of names)
        if (options[name]) yield `--${paramCase(name)}`;
    },
    negated: function* (...names) {
      for(const name of names)
        if (!options[name]) yield `--no-${paramCase(name)}`;
    },
    valued: function* (...names) {
      for(const name of names) {
        if (options[name]) {
          yield `--${paramCase(name)}`;
          yield* as_array(options[name]);
        }
      }
    }
  };
}

function start_ci_container(options) {
  const branch = execa.sync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.toString();

  if (!docker_volumes().includes('instrmt-build-cache')) {
    execa.sync('docker', ['docker', 'volume', 'create', 'instrmt-build-cache']);
  }

  const step = options.quiet ? `step -q` : `step`;

  const commands = [
    `${step} git clone --depth 1 -b ${branch} /repo /src`,
    `${step} ln -snf /cache/node_modules /src/node_modules`,
    `${step} ln -snf /cache/vendor /src/vendor`
  ];

  if (!options.fast)
    commands.push(`${step} npm i --production --prefer-offline --no-audit --progress=false`);

  const og = optgen(options);
  commands.push(shellquote.quote([
    'step', 'node', 'bootstrap.js', 'ci', // Not step -q otherwise there would be no output
    ...og.unary('fast', 'warningAsError', 'quiet'),
    ...og.negated('fullBuild', 'cmakeIntegration', 'runTests'),
    ...og.valued('cmakeVersion', 'ittapiVersion', 'tracyVersion', 'googleBenchmarkVersion')
  ]));

  let command_string = commands.join(' && ');

  if (options.shell)
    command_string = `${command_string} ; bash`;

  const docker_command = [
    'docker', 'run', '--rm', (options.shell ? '-it' : '-t'), '-v', `${__dirname}:/repo:ro`, '--mount', 'source=instrmt-build-cache,target=/cache',
    'instrmt-build',
    'bash', '-c', command_string
  ];

  return run_tasks([
    {
      title: shellquote.quote(docker_command),
      task: () => execa(docker_command[0], docker_command.slice(1), {stdio: 'inherit'})
        .catch(err => { throw new Error(`Command failed with exit code ${err.exitCode}`); })
    }
  ], options);
}

program
  .command('ci')
  .option('--docker', 'Run on a fresh clone in a docker container')
  .option('--shell', 'Keep shell open at the end.')
  .option('--fast', 'Skip npm modules and dependencies installation.')
  .option('--cmake-version <version>', 'Version of CMake to use')
  .option('--ittapi-version <version>', 'Version of ITT API to use', dependency('ittapi').version())
  .option('--tracy-version <version>', 'Version of Tracy to use', dependency('tracy').version())
  .option('--google-benchmark-version <version>', '', dependency('google-benchmark').version())
  .option('--no-full-build', 'Build everything.')
  .option('--no-cmake-integration', 'Verify CMake integration.')
  .option('--no-run-tests', 'Run tests.')
  .option('-W, --warning-as-error', 'Build with -Werror.')
  .option('-q, --quiet', 'Hide non-essential messages (e.g. only display external commands output if they fail).')
  .action(async (options) => {
    if (options.docker) {
      return start_ci_container(options);
    }

    const {fast, fullBuild, cmakeIntegration, runTests, warningAsError, quiet} = options;

    const cmake = options.cmakeVersion ? dependency('cmake3', options.cmakeVersion === true ? dependency('cmake3').version() : options.cmakeVersion) : undefined;
    const ittapi = dependency('ittapi', options.ittapiVersion);
    const tracy = dependency('tracy', options.tracyVersion);
    const google_benchmark = dependency('google-benchmark', options.googleBenchmarkVersion);

    if (cmake)
      process.env.PATH = [path.join(cmake.path(), 'bin')].concat((process.env.PATH || '').split(path.delimiter).filter(e => e)).join(path.delimiter);

    const tasks = [];

    if (!fast) {
      if (cmake) {
        tasks.push(
          fetch_cmake3_task({
            directory: path.join(__dirname, 'vendor'),
            version: cmake.version(),
            checksum: cmake.checksum()
          }),
        );
      }

      tasks.push(
        fetch_ittapi_task({
          directory: path.join(__dirname, 'vendor'),
          version: ittapi.version(),
          checksum: ittapi.checksum()
        }),
        fetch_tracy_task({
          directory: path.join(__dirname, 'vendor'),
          version: tracy.version(),
          checksum: tracy.checksum(),
          components: ['lib']
        }),
        fetch_tracy_task({
          directory: path.join(__dirname, 'vendor'),
          version: tracy.version(),
          checksum: tracy.checksum(),
          components: ['lib']
        })
      );

      if (fullBuild) {
        tasks.push(
          fetch_google_benchmark_task({
            directory: path.join(__dirname, 'vendor'),
            version: google_benchmark.version(),
            checksum: google_benchmark.checksum()
          })
        );
      }
    }

    tasks.push({
      title: 'Create temporary directory',
      task: (ctx, task) => {
        task.output = ctx.temp = fs.mkdtempSync(path.join(os.tmpdir(), 'instrmt-'));

        ctx.instrmt_bld = path.join(ctx.temp, 'instrmt-build');
        ctx.instrmt_dist = cmakeIntegration ? path.join(ctx.temp, 'instrmt-install') : undefined;
      }
    });

    tasks.push({
      task: (ctx, task) => task.newListr(
        instrmt_configure_build_tasks(
          ctx.instrmt_bld,
          {
            buildType: 'Release',
            installPrefix: ctx.instrmt_dist,
            ittapi: ittapi.path(),
            tracy: tracy.path(),
            googleBenchmark: fullBuild ? `${google_benchmark.path()}/lib/cmake/benchmark` : false,
            enableTests: fullBuild,
            build: ctx.instrmt_dist ? 'install' : true,
            cmakeArgs: warningAsError ? ['-DCMAKE_CXX_FLAGS=-Werror'] : []
          }
        )
      )
    });


    tasks.push({
      task: (ctx, task) => task.newListr(execa_task(['env', '-C', ctx.instrmt_bld, 'ctest'], {enabled: () => runTests}))
    });

    if (cmakeIntegration) {
      tasks.push({
        title: 'Verify CMake integration',
        task: (ctx, task) => task.newListr(
          cmake_integration_tasks(ctx.instrmt_bld, ctx.instrmt_dist, ctx.temp, ittapi.path(), tracy.path())
        )
      });
    }

    tasks.push({
      title: 'Cleanup',
      task: (ctx) => { rimraf.sync(ctx.temp); }
    });

    return run_tasks(tasks, options);
  });

program.parseAsync(process.argv)
  .catch(err => {
    console.error(err);
    process.exitCode = -1;
  });