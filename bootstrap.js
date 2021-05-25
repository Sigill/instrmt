#!/usr/bin/env node
"use strict;";

const assert = require('assert');
const chalk = require('chalk');
const crypto = require('crypto');
const execa = require('execa');
const fs = require('fs');
const fse = require('fs-extra');
const glob = require("glob");
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

function shell(command, args, { quiet = false, cwd, env, stdio = ['ignore', 'inherit', 'inherit'] } = {}) {
  const step_args = [command, ...args];
  if (quiet) step_args.unshift('-q');
  execa.sync(`${__dirname}/docker/step`, step_args, { stdio, cwd, env });
}

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

async function extract_tar_gz(archive, dest = '.', strip_components = 0) {
  console.log(chalk.blue(`Extracting ${archive} to ${dest}`));
  return mkdirp(dest).then(() => {
    return tar.x({ file: archive, strip: strip_components, C: dest });
  });
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

async function verify_md5(filename, expected_checksum) {
  console.log(chalk.blue(`Verifying checksum of ${filename}`));
  return md5sum(filename).then(actual_checksum => {
    if (actual_checksum !== expected_checksum)
      throw new Error(`md5(${filename}) = ${actual_checksum} != ${expected_checksum}`);
    console.log(chalk.green('Checksum ok'));
  });
}

async function download(url, dest) {
  console.log(chalk.blue(`Downloading ${url}`));

  if (fs.existsSync(dest)) {
    console.log(chalk.blue(`${dest} already exists, skipping download`));
    return Promise.resolve(dest);
  }

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

async function unpack_archive({url, file, checksum, download_dir, strip_components=0, dest} = {}) {
  assert(url || file, 'url or file must be specified');

  file ||= path.join(download_dir || os.tmpdir(), path.basename(new URL(url).pathname));

  if (url) {
    mkdirp.sync(path.dirname(file));
    await download(url, file);
  }

  if (checksum)
    await verify_md5(file, checksum);

  await extract_tar_gz(file, dest, strip_components);
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

function cmake_configure(src, bld, {cmake='cmake', buildType, installPrefix, args = []} = {}) {
  const cmd = cmake_configure_command(src, bld, {cmake, buildType, installPrefix, args});
  shell(cmd[0], cmd.slice(1));
}

function cmake_build(bld, {cmake, target} = {}) {
  cmake ||= 'cmake';
  var cmd = ['--build', bld];
  if (target !== undefined)
    cmd.push('--target', target);
  cmd.push('-j', `${nproc()}`);
  shell(cmake, cmd);
}

function cmake_basic_recipe(srcdir, builddir, {buildType = 'Release', installPrefix, args = []} = {}) {
  mkdirp.sync(builddir);
  cmake_configure(srcdir, builddir, {buildType, installPrefix, args});
  cmake_build(builddir, {target: installPrefix ? 'install' : undefined});
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

async function fetch_cmake28({directory = requiredArg('directory')} = {}) {
  const dirs = resolve_directories('cmake-2.8.12', directory);

  if (isDirectory(dirs.install)) {
    console.log(chalk.green(`${dirs.install} already exists, skipping`));
    return;
  }

  await unpack_archive({url: 'https://github.com/Kitware/CMake/archive/v2.8.12.tar.gz',
                        file: path.join(directory, 'cmake-2.8.12.tar.gz'),
                        checksum: '0dc2118e56f5c02dc5a90be9bd19befc',
                        dest: dirs.src,
                        strip_components: 1});

  shell('patch', ['-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'cmake2812-noqt.diff')]);
  mkdirp.sync(dirs.build);
  shell(path.join(dirs.src, 'bootstrap'), [`--parallel=${nproc()}`, '--no-qt-gui', `--prefix=${dirs.install}`], {cwd: dirs.build});
  shell('make', ['-C', dirs.build, `-j${nproc()}`, 'install']);

  dirs.temp.forEach(e => rimraf.sync(e));
}

async function fetch_cmake3({directory = requiredArg('directory'), version = requiredArg('version'), checksum} = {}) {
  const dirs = {install: path.join(directory, `cmake-${version}`)};

  if (isDirectory(dirs.install)) {
    console.log(chalk.green(`${dirs.install} already exists, skipping`));
    return;
  }

  await unpack_archive({url: `https://github.com/Kitware/CMake/releases/download/v${version}/cmake-${version}-Linux-x86_64.tar.gz`,
                        file: path.join(directory, `cmake-${version}-Linux-x86_64.tar.gz`),
                        checksum,
                        dest: dirs.install,
                        strip_components: 1});
}

async function fetch_ittapi({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType} = {}) {
  const dirs = resolve_directories(dependency('ittapi', version).basename(suffix), directory);

  if (isDirectory(dirs.install)) {
    console.log(chalk.green(`${dirs.install} already exists, skipping`));
    return;
  }

  await unpack_archive({url: `https://github.com/intel/ittapi/archive/${version}.tar.gz`,
                        file: path.join(directory, `ittapi-${version}.tar.gz`),
                        checksum,
                        dest: dirs.src,
                        strip_components: 1});

  cmake_basic_recipe(dirs.src, dirs.build, {buildType: cmakeBuildType});

  install(glob.sync(path.join(dirs.src, 'include', '**', '*.h?(pp)')),
          path.join(dirs.install, 'include'),
          {base: path.join(dirs.src, 'include')});
  install(path.join(dirs.build, 'bin', 'libittnotify.a'), path.join(dirs.install, 'lib64'));

  dirs.temp.forEach(e => rimraf.sync(e));
}

async function fetch_capstone({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType} = {}) {
  const dirs = resolve_directories(dependency('capstone', version).basename(suffix), directory);

  if (isDirectory(dirs.install)) {
    console.log(chalk.green(`${dirs.install} already exists, skipping`));
    return;
  }

  await unpack_archive({url: `https://github.com/aquynh/capstone/archive/${version}.tar.gz`,
                        file: path.join(directory, `capstone-${version}.tar.gz`),
                        checksum,
                        dest: dirs.src,
                        strip_components: 1});

  shell('patch', ['-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'capstone-pkgconfig-includedir.diff')]);

  cmake_basic_recipe(dirs.src, dirs.build, {buildType: cmakeBuildType, installPrefix: dirs.install});

  // Drop the dynamic libraries in order to force the use of the static ones when building tracy-profiler.
  glob.sync(path.join(dirs.install, 'lib', 'libcapstone.so*')).forEach(f => fs.rmSync(f));

  dirs.temp.forEach(e => rimraf.sync(e));
}

async function fetch_glfw({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType} = {}) {
  const dirs = resolve_directories(dependency('glfw', version).basename(suffix), directory);

  if (isDirectory(dirs.install)) {
    console.log(chalk.green(`${dirs.install} already exists, skipping`));
    return;
  }

  await unpack_archive({url: `https://github.com/glfw/glfw/archive/${version}.tar.gz`,
                        file: path.join(directory, `glfw-${version}.tar.gz`),
                        checksum,
                        dest: dirs.src,
                        strip_components: 1});

  cmake_basic_recipe(dirs.src, dirs.build,
                     {buildType: cmakeBuildType,
                      installPrefix: dirs.install,
                      args: ['-DGLFW_BUILD_DOCS=OFF', '-DGLFW_BUILD_EXAMPLES=OFF', '-DGLFW_BUILD_TESTS=OFF']});

  sed(path.join(dirs.install, 'lib/pkgconfig/glfw3.pc'), 'Requires.private:  x11', 'Requires:  x11');


  dirs.temp.forEach(e => rimraf.sync(e));
}

async function fetch_tracy({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, components, withGlfw, withCapstone} = {}) {
  const dirs = resolve_directories(dependency('tracy', version).basename(suffix), directory, {buildInSource: true});

  if (isDirectory(dirs.install)) {
    console.log(chalk.green(`${dirs.install} already exists, skipping`));
    return;
  }

  await unpack_archive({url: `https://github.com/wolfpld/tracy/archive/${version}.tar.gz`,
                        file: path.join(directory, `glfw-${version}.tar.gz`),
                        checksum,
                        dest: dirs.src,
                        strip_components: 1});

  if (semver.ltr(version, '0.7.2')) {
    shell('patch', ['-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'tracy-pkgconfig-static.diff')]);
  }

  if (version === 'master' || semver.gte(version, '0.7.6')) {
    ['TracyWorker.cpp', 'TracySourceView.cpp'].forEach(f => {
      sed(path.join(dirs.src, 'server', f), 'capstone.h', 'capstone/capstone.h');
    });
  }

  const build = (directory, {extra_pc_dirs = []} = {}) => {
    const PKG_CONFIG_PATH = extra_pc_dirs.concat((process.env.PKG_CONFIG_PATH || '').split(path.delimiter).filter(e => e)).join(path.delimiter);
    const env = Object.assign({}, process.env, {PKG_CONFIG_PATH});
    shell('make', ['-C', directory, '-j', `${nproc()}`, 'release'], {env});
  };

  if (components.includes('lib')) {
    build(path.join(dirs.src, 'library', 'unix'));
    install(path.join(dirs.src, 'library', 'unix', 'libtracy-release.so'), path.join(dirs.install, 'lib'), {filename: 'libtracy.so'});

    const installHeaders = (...subdirs) => {
      const files = glob.sync(path.join(dirs.src, ...subdirs, '*.h?(pp)'));
      install(files, path.join(dirs.install, 'include', ...subdirs));
    };

    installHeaders();
    installHeaders('client');
    installHeaders('common');

    // const files = glob.sync(path.join(dirs.src, '**', '*.h?(pp)')).filter(f => {
    //   return [dirs.src, path.join(dirs.src, 'client'), path.join(dirs.src, 'common')].includes(path.dirname(f));
    // });
    // install(files, path.join(dirs.install, 'include'), {base: dirs.src});

    // const files = glob.sync(path.join(dirs.src, '**', '*.h?(pp)'),
    //                         {ignore: [dirs.src, path.join(dirs.src, 'client'), path.join(dirs.src, 'common')].map(p => `${p}/*`)});
    // install(files, path.join(dirs.install, 'include'), {base: dirs.src});
  }

  if (components.includes('capture')) {
    const builddir = path.join(dirs.src, 'capture', 'build', 'unix');
    const extra_pc_dirs = [withCapstone].filter(e => e).map(d => path.join(d, 'lib', 'pkgconfig'));
    build(builddir, {extra_pc_dirs});
    install(path.join(builddir, 'capture-release'), path.join(dirs.install, 'bin'), {filename: 'capture'});
  }

  if (components.includes('profiler')) {
    const builddir = path.join(dirs.src, 'profiler', 'build', 'unix');
    const extra_pc_dirs = [withCapstone, withGlfw].filter(e => e).map(d => path.join(d, 'lib', 'pkgconfig'));
    build(builddir, {extra_pc_dirs});
    install(path.join(builddir, 'Tracy-release'), path.join(dirs.install, 'bin'), {filename: 'tracy'});
  }

  dirs.temp.forEach(e => rimraf.sync(e));
}

async function fetch_google_benchmark({directory = requiredArg('directory'), version = requiredArg('version'), suffix, checksum, cmakeBuildType} = {}) {
  const dirs = resolve_directories(dependency('google-benchmark', version).basename(suffix), directory);

  if (isDirectory(dirs.install)) {
    console.log(chalk.green(`${dirs.install} already exists, skipping`));
    return;
  }

  await unpack_archive({url: `https://github.com/google/benchmark/archive/${version}.tar.gz`,
                        file: path.join(directory, `google-benchmark-${version}.tar.gz`),
                        checksum,
                        dest: dirs.src,
                        strip_components: 1});

  cmake_basic_recipe(dirs.src, dirs.build, {buildType: cmakeBuildType, installPrefix: dirs.install, args: ['-DBENCHMARK_ENABLE_TESTING=OFF']});

  dirs.temp.forEach(e => rimraf.sync(e));
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
  .action(fetch_cmake28);

new FetchCommand('cmake3', 'CMake 3.x')
  .versionOption()
  .checksumOption()
  .action(fetch_cmake3);

new FetchCommand('ittapi', 'ITT API')
  .versionOption()
  .suffixOption()
  .checksumOption()
  .cmakeBuildtypeOption()
  .action(fetch_ittapi);

new FetchCommand('capstone', 'Capstone')
  .versionOption()
  .suffixOption()
  .checksumOption()
  .cmakeBuildtypeOption()
  .action(fetch_capstone);

new FetchCommand('glfw', 'GLFW')
  .versionOption()
  .suffixOption()
  .checksumOption()
  .cmakeBuildtypeOption()
  .action(fetch_glfw);

new FetchCommand('tracy', 'Tracy')
  .versionOption()
  .suffixOption()
  .checksumOption()
  .addOption(new commander.Option('--components <value...>', 'Components to build.').choices(['lib', 'capture', 'profiler']).default(['lib']))
  .option('--with-glfw <directory>', 'Root directory of glfw (location of lib/pkgconfig/glfw3.pc).')
  .optionsPostProcessor((options) => { options.withGlfw ??= dependency('glfw').path(options.directory); })
  .option('--with-capstone <directory>', 'Root directory of capstone (location of lib/pkgconfig/capstone.pc).')
  .optionsPostProcessor((options) => { options.withCapstone ??= dependency('capstone').path(options.directory); })
  .action(fetch_tracy);

new FetchCommand('google-benchmark')
  .versionOption()
  .suffixOption()
  .checksumOption()
  .cmakeBuildtypeOption()
  .action(fetch_google_benchmark);

program
  .command('fetch-dependencies')
  .description('Download and build dependencies.')
  .option('-C, --directory <directory>', 'Change to DIR before performing any operations.', absolute_path,
          __dirname === process.cwd() ? path.join(process.cwd(), 'vendor') : process.cwd())
  .action(async (options) => {
    await fetch_ittapi({directory: options.directory,
                        version: dependency('ittapi').default_version(),
                        checksum: dependency('ittapi').checksum()});

    await fetch_tracy({directory: options.directory,
                       version: dependency('tracy').default_version(),
                       checksum: dependency('tracy').checksum(),
                       components: ['lib']});

    await fetch_google_benchmark({directory: options.directory,
                                  version: dependency('google-benchmark').default_version(),
                                  checksum: dependency('google-benchmark').checksum()});
  });

function build_examples(instrmt_dir, build_dir, cmake_bin, ittapi_root, tracy_root) {
  cmake_configure(path.join(__dirname, 'example'), build_dir,
                  {buildType: 'Release',
                   cmake: cmake_bin,
                   args: [`-DInstrmt_DIR=${instrmt_dir}`, `-DVTUNE_ROOT=${ittapi_root}`, `-DTRACY_ROOT=${tracy_root}`]});
  cmake_build(build_dir, {cmake: cmake_bin});
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
  .action((options, command) => {
    let [cmd, ...args] = instrmt_configure_command(__dirname,
                                                   options.directory,
                                                   {
                                                     buildType: options.cmakeBuildType,
                                                     ittapi: options.withIttapi,
                                                     tracy: options.withTracy,
                                                     googleBenchmark: options.withBenchmarks,
                                                     vendorDir: path.join(__dirname, 'vendor'),
                                                     args: command.args
                                                   });

    shell(cmd, args);

    if (options.build) {
      if (options.build === true) {
        cmake_build(options.directory);
      } else {
        cmake_build(options.directory, {target: options.build});
      }
    }
  });

program
  .command('integration-tests')
  .description('Run integration tests')
  .option('--ittapi-root <directory>', '', absolute_path, dependency('ittapi').path(path.join(__dirname, 'vendor')))
  .option('--tracy-root <directory>', '', absolute_path, dependency('tracy').path(path.join(__dirname, 'vendor')))
  .option('--cmake <file>', '', absolute_path, 'cmake')
  .action((options) => {
    shell(options.cmake, ['--version']);

    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'instrmt-it-'));
    const instrmt_bld = path.join(temp, 'instrmt-build');
    const instrmt_dist = path.join(temp, 'instrmt-install');

    cmake_configure(__dirname, instrmt_bld,
                    {cmake: options.cmake,
                     buildType: 'Release',
                     installPrefix: instrmt_dist,
                     args: [
                       '-DINSTRMT_BUILD_ITT_ENGINE=ON', `-DVTUNE_ROOT=${options.ittapiRoot}`,
                       '-DINSTRMT_BUILD_TRACY_ENGINE=ON', `-DTRACY_ROOT=${options.tracyRoot}`,
                       '-DBUILD_BENCHMARKS=OFF', '-DBUILD_TESTING=OFF'
                     ]});

    cmake_build(instrmt_bld, {cmake: options.cmake, target: 'install'});

    build_examples(instrmt_bld,
                   path.join(temp, 'example-from-build'),
                   options.cmake, options.ittapiRoot, options.tracyRoot);
    build_examples(path.join(instrmt_dist, 'share', 'cmake', 'instrmt'),
                   path.join(temp, 'example-from-install'),
                   options.cmake, options.ittapiRoot, options.tracyRoot);

    rimraf.sync(temp);
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

      const commands = [
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
      commands.push(shellquote.quote(['node', 'bootstrap.js', 'ci', ...ci_opts()]));

      const step = quiet ? 'step -q' : 'step';
      let script = commands.map(e => `${step} ${e}`).join(' && ');

      if (options.shell) {
        script = `${script} ; bash`;
      }

      shell('docker',
            [ 'run', '--rm', (options.shell ? '-it' : '-t'), '-v', `${__dirname}:/repo:ro`, '--mount', 'source=instrmt-build-cache,target=/cache',
              'instrmt-build',
              'bash', '-c', script ],
            {stdio: 'inherit'});
    } else {
      if (!options.fast) {
        shell('node', ['bootstrap.js', 'fetch-ittapi'], {quiet});
        shell('node', ['bootstrap.js', 'fetch-tracy'], {quiet});
        shell('node', ['bootstrap.js', 'fetch-google-benchmark'], {quiet});
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

      shell(configure[0], configure.slice(1), {quiet});
      shell('cmake', ['--build', path.join(__dirname, 'build'), '-j', `${nproc()}`], {quiet});

      if (options.test) {
        shell('env', ['-C', 'build', 'ctest'], {quiet});
        shell('node', ['bootstrap.js', 'integration-tests', '--ittapi-root', ittapi_dir, '--tracy-root', tracy_dir], {quiet});
      }
    }

  });

program.parseAsync(process.argv)
  .catch(err => {
    console.error(err);
    process.exitCode = -1;
  });