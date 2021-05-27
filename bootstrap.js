#!/usr/bin/env node
"use strict;";

const assert = require('assert');
const crypto = require('crypto');
const execa = require('execa');
const fs = require('fs');
const fse = require('fs-extra');
const glob = require('glob');
var hasbin = require('hasbin');
const Listr = require('listr');
const https = require('follow-redirects').https;
const mkdirp = require('mkdirp');
const os = require('os');
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

  var install = path.join(workdir, basename);

  if (buildInSource) {
    if (skipInstall) {
      const src = path.join(workdir, basename);
      return { src: src,
               build: src,
               install,
               temp: [] };
    } else {
      const src = path.join(tmpdir, `${basename}-src`);
      return { src: src,
               build: path.join(workdir, basename),
               install,
               temp: [src] };
    }
  } else {
    if (skipInstall) {
      return { src: path.join(workdir, `${basename}-src`),
               build: path.join(workdir, basename),
               install,
               temp: [] };
    } else {
      const tmp = path.join(tmpdir, basename);
      return { src: path.join(tmp, 'src'),
               build: path.join(tmp, 'bld'),
               install,
               temp: [tmp] };
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

function cmake_build_command(bld, {cmake, target} = {}) {
  cmake ||= 'cmake';
  var cmd = ['--build', bld];
  if (target !== undefined)
    cmd.push('--target', target);
  cmd.push('-j', `${nproc()}`);
  return [cmake, ...cmd];
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

function listr_execa_promise(command, {quiet=false, env, cwd} = {}) {
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

function listr_execa_task(command, {quiet=false, title, skip, enabled, env, cwd, pre, post} = {}) {
  return {
    title: title || shellquote.quote(command),
    skip,
    enabled,
    task: (ctx, task) => {
      const f = () => listr_execa_promise(command, {quiet, env, cwd});

      let chain = pre
        ? new Promise( resolve => resolve(pre(ctx, task)) ).then(f)
        : f();
      if (post)
        chain = chain.then(() => post(ctx, task));
      return chain;
    }
  };
}

function listr_download_task(url, file, {quiet} = {}) {
  return {
    title: `Download ${url}`,
    skip: () => fs.existsSync(file) && (quiet || `${file} already exists`),
    task: () => mkdirp(path.dirname(file)).then(() => download(url, file))
  };
}

function listr_checksum_task(file, expected_checksum, {quiet} = {}) {
  return {
    title: `Verify checksum of ${file}`,
    skip: () => !expected_checksum && (quiet || 'Checksum not specified'),
    task: () => md5sum(file).then(actual_checksum => {
      if (actual_checksum !== expected_checksum)
        throw new Error(`md5(${file}) = ${actual_checksum} != ${expected_checksum}`);
    })
  };
}

function listr_extract_task(archive, dest, {strip_components} = {}) {
  return {
    title: `Extract ${archive}`,
    task: () => mkdirp(dest).then(() => tar.x({ file: archive, strip: strip_components, C: dest }))
  };
}

function* listr_download_and_extract_tasks(url, archive, checksum, dest, quiet, {strip_components} = {}) {
  yield listr_download_task(url, archive, quiet);
  yield listr_checksum_task(archive, checksum, quiet);
  yield listr_extract_task(archive, dest, {strip_components});
}

function listr_cleanup_task(files) {
  return {
    title: 'Cleanup',
    task: () => files.forEach(e => rimraf.sync(e))
  };
}

function fetch_cmake28_task({directory = requiredArg('directory'), quiet} = {}) {
  const dirs = resolve_directories('cmake-2.8.12', directory);
  const url = 'https://github.com/Kitware/CMake/archive/v2.8.12.tar.gz';
  const archive = path.join(directory, 'cmake-2.8.12.tar.gz');

  return {
    title: 'Fetch CMake 2.8.12',
    skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
    task: () => new Listr([
      ...listr_download_and_extract_tasks(url, archive, '0dc2118e56f5c02dc5a90be9bd19befc', dirs.src, quiet, {strip_components: 1}),
      listr_execa_task(['patch', '-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'cmake2812-noqt.diff')], {quiet}),
      listr_execa_task([path.join(dirs.src, 'bootstrap'), `--parallel=${nproc()}`, '--no-qt-gui', `--prefix=${dirs.install}`],
                       {cwd: dirs.build, pre: () => mkdirp(dirs.build), quiet}),
      listr_execa_task(['make', '-C', dirs.build, `-j${nproc()}`, 'install'], {quiet}),
      listr_cleanup_task(dirs.temp)
    ])
  };
}

function fetch_cmake3_task({directory = requiredArg('directory'), version = requiredArg('version'), checksum, quiet} = {}) {
  const dirs = {install: path.join(directory, `cmake-${version}`)};
  const url = `https://github.com/Kitware/CMake/releases/download/v${version}/cmake-${version}-Linux-x86_64.tar.gz`;
  const archive = path.join(directory, `cmake-${version}-Linux-x86_64.tar.gz`);

  return {
    title: 'Fetch CMake 3',
    skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
    task: () => new Listr([
      ...listr_download_and_extract_tasks(url, archive, checksum, dirs.install, quiet, {strip_components: 1})
    ])
  };
}

function fetch_ittapi_task({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType, quiet} = {}) {
  const dirs = resolve_directories(dependency('ittapi', version).basename(suffix), directory);
  const url = `https://github.com/intel/ittapi/archive/${version}.tar.gz`;
  const archive = path.join(directory, `ittapi-${version}.tar.gz`);

  return {
    title: 'Fetch ittapi',
    skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
    task: () => new Listr([
      ...listr_download_and_extract_tasks(url, archive, checksum, dirs.src, quiet, {strip_components: 1}),
      listr_execa_task(cmake_configure_command(dirs.src, dirs.build, {cmakeBuildType, args: []}),
                       {pre: () => mkdirp(dirs.build), quiet}),
      listr_execa_task(cmake_build_command(dirs.build), {quiet}),
      {
        title: 'Install',
        task: () => {
          install(glob.sync(path.join(dirs.src, 'include', '**', '*.h?(pp)')),
                  path.join(dirs.install, 'include'),
                  {base: path.join(dirs.src, 'include')});
          install(path.join(dirs.build, 'bin', 'libittnotify.a'), path.join(dirs.install, 'lib64'));
        }
      },
      listr_cleanup_task(dirs.temp)
    ])
  };
}

function fetch_capstone_task({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType, quiet} = {}) {
  const dirs = resolve_directories(dependency('capstone', version).basename(suffix), directory);
  const url = `https://github.com/aquynh/capstone/archive/${version}.tar.gz`;
  const archive = path.join(directory, `capstone-${version}.tar.gz`);

  return {
    title: 'Fetch capstone',
    skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
    task: () => new Listr([
      ...listr_download_and_extract_tasks(url, archive, checksum, dirs.src, quiet, {strip_components: 1}),
      listr_execa_task(['patch', '-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'capstone-pkgconfig-includedir.diff')], {quiet}),
      listr_execa_task(cmake_configure_command(dirs.src, dirs.build, {cmakeBuildType, installPrefix: dirs.install, args: []}),
                       {pre: () => mkdirp(dirs.build), quiet}),
      listr_execa_task(cmake_build_command(dirs.build, {target: 'install'}), {quiet}),
      {
        title: 'Discard dynamic libraries',
        task: () => glob.sync(path.join(dirs.install, 'lib', 'libcapstone.so*')).forEach(f => fs.rmSync(f))
      },
      listr_cleanup_task(dirs.temp)
    ])
  };
}

function fetch_glfw_task({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType, quiet} = {}) {
  const dirs = resolve_directories(dependency('glfw', version).basename(suffix), directory);
  const url = `https://github.com/glfw/glfw/archive/${version}.tar.gz`;
  const archive = path.join(directory, `glfw-${version}.tar.gz`);

  return {
    title: 'Fetch glfw',
    skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
    task: () => new Listr([
      ...listr_download_and_extract_tasks(url, archive, checksum, dirs.src, quiet, {strip_components: 1}),
      listr_execa_task(cmake_configure_command(dirs.src, dirs.build,
                                               {
                                                 cmakeBuildType, installPrefix: dirs.install,
                                                 args: ['-DGLFW_BUILD_DOCS=OFF', '-DGLFW_BUILD_EXAMPLES=OFF', '-DGLFW_BUILD_TESTS=OFF']
                                               }),
                       {pre: () => mkdirp(dirs.build), quiet}),
      listr_execa_task(cmake_build_command(dirs.build, {target: 'install'}), {quiet}),
      {
        title: 'Fix pkgconfig file',
        task: () => sed(path.join(dirs.install, 'lib/pkgconfig/glfw3.pc'), 'Requires.private:  x11', 'Requires:  x11')
      },
      listr_cleanup_task(dirs.temp)
    ])
  };
}

function fetch_tracy_task({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, components, withGlfw, withCapstone, quiet} = {}) {
  const dirs = resolve_directories(dependency('tracy', version).basename(suffix), directory, {buildInSource: true});
  const url = `https://github.com/wolfpld/tracy/archive/${version}.tar.gz`;
  const archive = path.join(directory, `tracy-${version}.tar.gz`);

  const buildTask = (directory, {extra_pc_dirs = [], skip, enabled} = {}) => {
    const PKG_CONFIG_PATH = extra_pc_dirs.concat((process.env.PKG_CONFIG_PATH || '').split(path.delimiter).filter(e => e)).join(path.delimiter);
    const env = Object.assign({}, process.env, {PKG_CONFIG_PATH});
    return listr_execa_task(['make', '-C', directory, '-j', `${nproc()}`, 'release'], {env, skip, enabled});
  };

  return {
    title: 'Fetch tracy',
    skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
    task: () => new Listr([
      ...listr_download_and_extract_tasks(url, archive, checksum, dirs.src, quiet, {strip_components: 1}),
      listr_execa_task(['patch', '-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'tracy-pkgconfig-static.diff')],
                       {quiet, enabled: () => semver.ltr(version, '0.7.2')}),
      {
        title: `Fix includes`,
        enabled: () => version === 'master' || semver.gte(version, '0.7.6'),
        task: () => {
          ['TracyWorker.cpp', 'TracySourceView.cpp'].forEach(f => {
            sed(path.join(dirs.src, 'server', f), 'capstone.h', 'capstone/capstone.h');
          });
        }
      },
      buildTask(path.join(dirs.src, 'library', 'unix'), {enabled: () => components.includes('lib')}),
      {
        title: 'Install library',
        enabled: () => components.includes('lib'),
        task: () => {
          install(path.join(dirs.src, 'library', 'unix', 'libtracy-release.so'), path.join(dirs.install, 'lib'), {filename: 'libtracy.so'});

          const installHeaders = (...subdirs) => {
            const files = glob.sync(path.join(dirs.src, ...subdirs, '*.h?(pp)'));
            install(files, path.join(dirs.install, 'include', ...subdirs));
          };

          installHeaders();
          installHeaders('client');
          installHeaders('common');
        }
      },
      buildTask(path.join(dirs.src, 'capture', 'build', 'unix'),
                {
                  extra_pc_dirs: [withCapstone].filter(e => e).map(d => path.join(d, 'lib', 'pkgconfig')),
                  enabled: () => components.includes('capture')
                }),
      {
        title: 'Install capture',
        enabled: () => components.includes('capture'),
        task: () => {
          install(path.join(path.join(dirs.src, 'capture', 'build', 'unix'), 'capture-release'), path.join(dirs.install, 'bin'), {filename: 'capture'});
        }
      },
      buildTask(path.join(dirs.src, 'profiler', 'build', 'unix'),
                {
                  extra_pc_dirs: [withCapstone, withGlfw].filter(e => e).map(d => path.join(d, 'lib', 'pkgconfig')),
                  enabled: () => components.includes('profiler')
                }),
      {
        title: 'Install profiler',
        enabled: () => components.includes('profiler'),
        task: () => {
          install(path.join(path.join(dirs.src, 'profiler', 'build', 'unix'), 'Tracy-release'), path.join(dirs.install, 'bin'), {filename: 'tracy'});
        }
      },
      listr_cleanup_task(dirs.temp)
    ])
  };
}

function fetch_google_benchmark_task({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType, quiet} = {}) {
  const dirs = resolve_directories(dependency('google-benchmark', version).basename(suffix), directory);
  const url = `https://github.com/google/benchmark/archive/${version}.tar.gz`;
  const archive = path.join(directory, `google-benchmark-${version}.tar.gz`);

  return {
    title: 'Fetch google-benchmark',
    skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
    task: () => new Listr([
      ...listr_download_and_extract_tasks(url, archive, checksum, dirs.src, quiet, {strip_components: 1}),
      listr_execa_task(cmake_configure_command(dirs.src, dirs.build,
                                               {
                                                 cmakeBuildType, installPrefix: dirs.install,
                                                 args: ['-DBENCHMARK_ENABLE_TESTING=OFF']
                                               }),
                       {pre: () => mkdirp(dirs.build), quiet}),
      listr_execa_task(cmake_build_command(dirs.build, {target: 'install'}), {quiet}),
      listr_cleanup_task(dirs.temp)
    ])
  };
}

function absolute_path(p) { return path.resolve(p); }

const dependencies = {
  cmake3: {
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
      return [name, pretty_version(version), suffix].filter(e => e).join('-');
    },
    path: function(prefix = path.join(__dirname, 'vendor')) {
      return path.join(prefix, this.basename());
    },
    checksum: function() {
      return dependencies[name]?.[version]?.checksum;
    },
    default_version: function() {
      return dependencies[name].default_version;
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
              __dirname === process.cwd() ? path.join(process.cwd(), 'vendor') : process.cwd());
  }

  optionsPostProcessor(fn) { this.optionsPostProcessors.push(fn); return this;}

  versionOption() {
    this.cmd.option('-v, --version <value>', 'Overrides version.', dependency(this.name).default_version());
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
  .option('-q, --quiet', '')
  .action((options) => new Listr([fetch_cmake28_task(options)], {renderer: 'verbose'}).run());

new FetchCommand('cmake3', 'CMake 3.x')
  .versionOption()
  .checksumOption()
  .option('-q, --quiet', '')
  .action((options) => new Listr([fetch_cmake3_task(options)], {renderer: 'verbose'}).run());

new FetchCommand('ittapi', 'ITT API')
  .versionOption()
  .suffixOption()
  .checksumOption()
  .cmakeBuildtypeOption()
  .option('-q, --quiet', '')
  .action((options) => new Listr([fetch_ittapi_task(options)], {renderer: 'verbose'}).run());

new FetchCommand('capstone', 'Capstone')
  .versionOption()
  .suffixOption()
  .checksumOption()
  .cmakeBuildtypeOption()
  .option('-q, --quiet', '')
  .action((options) => new Listr([fetch_capstone_task(options)], {renderer: 'verbose'}).run());

new FetchCommand('glfw', 'GLFW')
  .versionOption()
  .suffixOption()
  .checksumOption()
  .cmakeBuildtypeOption()
  .option('-q, --quiet', '')
  .action((options) => new Listr([fetch_glfw_task(options)], {renderer: 'verbose'}).run());

new FetchCommand('tracy', 'Tracy')
  .versionOption()
  .suffixOption()
  .checksumOption()
  .addOption(new commander.Option('--components <value...>', 'Components to build.').choices(['lib', 'capture', 'profiler']).default(['lib']))
  .option('--with-glfw <directory>', 'Root directory of glfw (location of lib/pkgconfig/glfw3.pc).')
  .optionsPostProcessor((options) => { options.withGlfw ??= dependency('glfw').path(options.directory); })
  .option('--with-capstone <directory>', 'Root directory of capstone (location of lib/pkgconfig/capstone.pc).')
  .optionsPostProcessor((options) => { options.withCapstone ??= dependency('capstone').path(options.directory); })
  .option('-q, --quiet', '')
  .action((options) => new Listr([fetch_tracy_task(options)], {renderer: 'verbose'}).run());

new FetchCommand('google-benchmark')
  .versionOption()
  .suffixOption()
  .checksumOption()
  .cmakeBuildtypeOption()
  .option('-q, --quiet', '')
  .action((options) => new Listr([fetch_google_benchmark_task(options)], {renderer: 'verbose'}).run());

program
  .command('fetch-dependencies')
  .description('Download and build dependencies.')
  .option('-C, --directory <directory>', 'Change to DIR before performing any operations.', absolute_path,
          __dirname === process.cwd() ? path.join(process.cwd(), 'vendor') : process.cwd())
  .action(async (options) => {
    return new Listr([
      fetch_ittapi_task({
        directory: options.directory,
        version: dependency('ittapi').default_version(),
        checksum: dependency('ittapi').checksum()
      }),
      fetch_tracy_task({
        directory: options.directory,
        version: dependency('tracy').default_version(),
        checksum: dependency('tracy').checksum(),
        components: ['lib']
      }),
      fetch_google_benchmark_task({
        directory: options.directory,
        version: dependency('google-benchmark').default_version(),
        checksum: dependency('google-benchmark').checksum()
      })
    ], {renderer: 'verbose'}).run();
  });

function build_examples(instrmt_dir, build_dir, cmake_bin, ittapi_root, tracy_root) {
  return [
    cmake_configure_command(path.join(__dirname, 'example'), build_dir,
                            {
                              buildType: 'Release',
                              cmake: cmake_bin,
                              args: [`-DInstrmt_DIR=${instrmt_dir}`, `-DVTUNE_ROOT=${ittapi_root}`, `-DTRACY_ROOT=${tracy_root}`]
                            }),
    cmake_build_command(build_dir, {cmake: cmake_bin})
  ];
}

function instrmt_configure_command(srcdir, builddir, {buildType, ittapi, tracy, googleBenchmark, vendorDir, args = []} = {}) {
  let cmakeArgs = [];

  if (ittapi) {
    if (ittapi === true)
      ittapi = dependency('ittapi').path(vendorDir);
    cmakeArgs.push('-DINSTRMT_BUILD_ITT_ENGINE=ON', `-DVTUNE_ROOT=${ittapi}`);
  }
  if (tracy) {
    if (tracy === true)
      tracy = dependency('tracy').path(vendorDir);
    cmakeArgs.push('-DINSTRMT_BUILD_TRACY_ENGINE=ON', `-DTRACY_ROOT=${tracy}`);
  }
  if (googleBenchmark) {
    if (googleBenchmark === true)
      googleBenchmark = path.join(dependency('google-benchmark').path(vendorDir), 'lib', 'cmake', 'benchmark');
    cmakeArgs.push('-DBUILD_BENCHMARKS=ON', `-Dbenchmark_DIR=${googleBenchmark}`);
  }

  cmakeArgs = cmakeArgs.concat(args);

  return cmake_configure_command(srcdir, builddir, {buildType, args: cmakeArgs});
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
  .option('-q, --quiet', '')
  .action((options, command) => {
    const configure = instrmt_configure_command(__dirname,
                                                options.directory,
                                                {
                                                  buildType: options.cmakeBuildType,
                                                  ittapi: options.withIttapi,
                                                  tracy: options.withTracy,
                                                  googleBenchmark: options.withBenchmarks,
                                                  vendorDir: path.join(__dirname, 'vendor'),
                                                  args: command.args
                                                });

    const build = cmake_build_command(options.directory,
                                      {target: (options.build && options.build === true) ? undefined : options.build});

    return new Listr([
      listr_execa_task(configure, {quiet: options.quiet}),
      listr_execa_task(build, {quiet: options.quiet, enabled: () => !!options.build})
    ], {renderer: 'verbose'}).run();
  });

program
  .command('integration-tests')
  .description('Run integration tests')
  .option('--ittapi-root <directory>', '', absolute_path, dependency('ittapi').path(path.join(__dirname, 'vendor')))
  .option('--tracy-root <directory>', '', absolute_path, dependency('tracy').path(path.join(__dirname, 'vendor')))
  .option('--cmake <file>', '', absolute_path, 'cmake')
  .option('-q, --quiet', '')
  .action((options) => {
    return new Listr([
      {
        title: 'Create temporary directory',
        task: (ctx, task) => {
          ctx.temp = fs.mkdtempSync(path.join(os.tmpdir(), 'instrmt-it-'));
          task.output = ctx.temp;
          ctx.instrmt_bld = path.join(ctx.temp, 'instrmt-build');
          ctx.instrmt_dist = path.join(ctx.temp, 'instrmt-install');
        }
      },
      {
        title: 'Configure instrmt',
        task: (ctx, task) => {
          const configure_command = cmake_configure_command(__dirname, ctx.instrmt_bld,
                                                            {
                                                              cmake: options.cmake,
                                                              buildType: 'Release',
                                                              installPrefix: ctx.instrmt_dist,
                                                              args: [
                                                                '-DINSTRMT_BUILD_ITT_ENGINE=ON', `-DVTUNE_ROOT=${options.ittapiRoot}`,
                                                                '-DINSTRMT_BUILD_TRACY_ENGINE=ON', `-DTRACY_ROOT=${options.tracyRoot}`,
                                                                '-DBUILD_BENCHMARKS=OFF', '-DBUILD_TESTING=OFF'
                                                              ]
                                                            });
          task.title = shellquote.quote(configure_command);
          return listr_execa_promise(configure_command, {quiet: options.quiet});
        }
      },
      {
        title: 'Build instrmt',
        task: (ctx, task) => {
          const build_command = cmake_build_command(ctx.instrmt_bld, {cmake: options.cmake, target: 'install'});
          task.title = shellquote.quote(build_command);
          return listr_execa_promise(build_command, {quiet: options.quiet});
        }
      },
      {
        title: 'Build examples using instrmt build tree',
        task: (ctx) => {
          const commands = build_examples(ctx.instrmt_bld,
                                          path.join(ctx.temp, 'example-from-build'),
                                          options.cmake, options.ittapiRoot, options.tracyRoot);
          return new Listr(commands.map(c => listr_execa_task(c, {quiet: options.quiet})));
        }
      },
      {
        title: 'Build examples using instrmt install tree',
        task: (ctx) => {
          const commands = build_examples(path.join(ctx.instrmt_dist, 'share', 'cmake', 'instrmt'),
                                          path.join(ctx.temp, 'example-from-install'),
                                          options.cmake, options.ittapiRoot, options.tracyRoot);
          return new Listr(commands.map(c => listr_execa_task(c, {quiet: options.quiet})));
        }
      },
      {
        title: 'Cleanup',
        task: (ctx) => { rimraf.sync(ctx.temp); }
      }
    ], {renderer: 'verbose'}).run();
  });

function docker_volumes() {
  return execa.sync('docker', ['volume', 'ls']).stdout.split('\n').slice(1).map(l => l.split(/ +/)[1]);
}

program
  .command('ci')
  .option('--docker', '')
  .option('--fast', 'Skip npm modules and dependencies installation.')
  .option('--shell', 'Keep shell open at the end.')
  .option('-W, --warning-as-error', '')
  .option('-q, --quiet', '')
  .option('--no-test', '')
  .action(async (options) => {
    const quiet = !!options.quiet;

    if (options.docker) {
      const branch = execa.sync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.toString();

      if (!docker_volumes().includes('instrmt-build-cache')) {
        execa.sync('docker', ['docker', 'volume', 'create', 'instrmt-build-cache']);
      }

      let commands = [
        `git clone --depth 1 -b ${branch} /repo /src`,
        `ln -snf /cache/node_modules /src/node_modules`,
        `ln -snf /cache/vendor /src/vendor`
      ];

      if (!options.fast) {
        commands.push('npm i --production');
      }

      const ci_opts = function*() {
        if (options.fast) yield '--fast';
        if (options.warningAsError) yield '-W';
        if (options.test) yield '--test'; else yield '--no-test';
        if (quiet) yield '-q';
      };

      const step = quiet ? 'step -q' : 'step';
      commands = commands.map(e => `${step} ${e}`);

      commands.push(shellquote.quote(['node', 'bootstrap.js', 'ci', ...ci_opts()]));

      let script = commands.join(' && ');
      if (options.shell) {
        script = `${script} ; bash`;
      }

      const docker_command = [
        'docker', 'run', '--rm', (options.shell ? '-it' : '-t'), '-v', `${__dirname}:/repo:ro`, '--mount', 'source=instrmt-build-cache,target=/cache',
        'instrmt-build',
        'bash', '-c', script
      ];
      return new Listr([
        {
          title: shellquote.quote(docker_command),
          task: () => execa(docker_command[0], docker_command.slice(1), {stdio: 'inherit'})
            .catch(err => { throw new Error(`Command failed with exit code ${err.exitCode}`); })
        }
      ], {renderer: 'verbose'}).run();
    } else {
      const tasks = [];

      if (!options.fast) {
        tasks.push(fetch_ittapi_task({directory: path.join(__dirname, 'vendor'),
                                      version: dependency('ittapi').default_version(),
                                      checksum: dependency('ittapi').checksum(),
                                      quiet}));

        tasks.push(fetch_tracy_task({directory: path.join(__dirname, 'vendor'),
                                     version: dependency('tracy').default_version(),
                                     checksum: dependency('tracy').checksum(),
                                     components: ['lib'],
                                     quiet}));

        tasks.push(fetch_google_benchmark_task({directory: path.join(__dirname, 'vendor'),
                                                version: dependency('google-benchmark').default_version(),
                                                checksum: dependency('google-benchmark').checksum(),
                                                quiet}));
      }

      const ittapi_dir = dependency('ittapi').path();
      const tracy_dir = dependency('tracy').path();
      const google_benchmark_dir = `${dependency('google-benchmark').path()}/lib/cmake/benchmark`;

      const configure = instrmt_configure_command(__dirname,
                                                  path.join(__dirname, 'build'),
                                                  {
                                                    buildType: 'Release',
                                                    ittapi: ittapi_dir,
                                                    tracy: tracy_dir,
                                                    googleBenchmark: google_benchmark_dir,
                                                    args: options.warningAsError ? ['-DCMAKE_CXX_FLAGS=-Werror'] : []
                                                  });

      tasks.push(listr_execa_task(configure, {quiet}));
      tasks.push(listr_execa_task(['cmake', '--build', path.join(__dirname, 'build'), '-j', `${nproc()}`], {quiet}));

      if (options.test) {
        tasks.push(listr_execa_task(['env', '-C', 'build', 'ctest'], {quiet}));
        tasks.push(listr_execa_task(['node', 'bootstrap.js', 'integration-tests', '--ittapi-root', ittapi_dir, '--tracy-root', tracy_dir], {quiet}));
      }

      return new Listr(tasks, {renderer: 'verbose'}).run();
    }

  });

program.parseAsync(process.argv)
  .catch(err => {
    console.error(err);
    process.exitCode = -1;
  });