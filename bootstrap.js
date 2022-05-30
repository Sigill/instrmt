import * as global_agent from 'global-agent';
global_agent.bootstrap();
import arrify from 'arrify';
import assert from 'assert';
import commander from 'commander';
import dargs from 'dargs';
import execa from 'execa';
import fs from 'fs';
import * as fse from 'fs-extra';
import glob from 'glob';
import got from 'got';
import isInteractive from 'is-interactive';
import hasbin from 'hasbin';
import hasha from 'hasha';
import mkdirp from 'mkdirp';
import os from 'os';
import path from 'path';
import pathIsInside from 'path-is-inside';
import { promisify } from 'util';
import replaceInFile from 'replace-in-file';
import rimraf from 'rimraf';
import semver from 'semver';
import shellquote from 'shell-quote';
import stream from 'stream';
import tar from 'tar';
import { ValueOrPromise } from 'value-or-promise';
import { step } from '@sigill/watch-your-step';
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const nproc = os.cpus().length;
const default_vendor_dir = __dirname === process.cwd() ? path.join(process.cwd(), 'vendor') : process.cwd();
function cmake_configure_command(src, bld, { cmake = 'cmake', buildType, installPrefix, args = [] } = {}) {
    const cmd = [cmake, '-S', src, '-B', bld];
    if (buildType)
        cmd.push(`-DCMAKE_BUILD_TYPE=${buildType}`);
    if (installPrefix)
        cmd.push(`-DCMAKE_INSTALL_PREFIX=${installPrefix}`);
    cmd.push(...arrify(args));
    return cmd;
}
function cmake_build_command(bld, { cmake = 'cmake', target } = {}) {
    const cmd = [cmake, '--build', bld];
    if (target !== undefined)
        cmd.push('--target', target);
    cmd.push('-j', `${nproc}`);
    return cmd;
}
function install(files, dir, { filename, base } = {}) {
    files = arrify(files);
    assert(files.length > 0, 'No file to install');
    assert(filename === undefined || files.length === 1, 'Cannot use the "filename" option when installing multiple files');
    const finalPath = (f) => {
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
        fse.copySync(f, finalPath(f), { preserveTimestamps: true });
    });
}
function sed(files, from, to) {
    replaceInFile.sync({ files, from, to })
        .filter(result => !result.hasChanged)
        .forEach(result => { throw new Error(`${result.file}: No match for ${from}`); });
}
function pretty_version(v) {
    const is_semver = v.match(/^v?(?:(\d+))(?:\.(\d+))?(\.\d+)?$/);
    if (!is_semver)
        return v;
    return semver.valid(semver.coerce(v));
}
function match_version(version, { tag = [], range } = {}) {
    version = pretty_version(version) || (() => { throw new Error('Not a version'); })();
    if (arrify(tag).includes(version))
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
    }
    else {
        return [command[0], command.slice(1)];
    }
}
function pretty_command(command, { env, cwd } = {}) {
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
function dependency(name, { version, suffix, prefix = default_vendor_dir } = {}) {
    assert(dependencies[name], `Unknown dependency ${name}`);
    version ||= dependencies[name].default_version;
    const basename = [dependencies[name].basename || name, pretty_version(version), suffix].filter(e => e).join('-');
    const root = path.join(prefix, basename);
    const checksum = dependencies[name]?.[version]?.checksum;
    return {
        basename, root, checksum, version,
        build_directories: function ({ buildInSource = false, skipInstall = false } = {}) {
            const install = root;
            if (skipInstall) {
                if (buildInSource) {
                    return { src: install, build: install, install, temp: [] };
                }
                else {
                    return { src: path.join(prefix, `${basename}-src`), build: install, install, temp: [] };
                }
            }
            else {
                const src = path.join(prefix, 'tmp', `${basename}-src`);
                if (buildInSource) {
                    return { src, build: install, install, temp: [src] };
                }
                else {
                    const build = path.join(prefix, 'tmp', basename, 'build');
                    return { src, build, install, temp: [src, build] };
                }
            }
        }
    };
}
function steps({ quiet } = {}) {
    return {
        withTempdir: function (prefix, action) {
            const tempdir = fs.mkdtempSync(prefix);
            return new ValueOrPromise(() => action(tempdir))
                .then((...args) => { this.cleanup(tempdir); return args; }, (err) => { this.cleanup(tempdir); throw err; })
                .resolve();
        },
        execa: function (command, { title, skip, env, cwd } = {}) {
            return step({
                title: title || pretty_command(command, { cwd, env }),
                skip,
                action: () => {
                    const p = quiet
                        ? execa(...unbuffer(command), { env, cwd, all: true })
                        : execa(command[0], command.slice(1), { env, cwd, stdio: 'inherit' });
                    return p
                        .catch(err => {
                        if (err.exitCode) {
                            if (err.all)
                                console.log(err.all);
                            throw new Error(`Command failed with exit code ${err.exitCode}`);
                        }
                        else
                            throw err;
                    });
                }
            });
        },
        download: function (url, file) {
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
                    const { algorithm, hash: expected_hash } = expected_checksum;
                    return hasha.fromFile(file, { algorithm }).then(actual_hash => {
                        if (actual_hash !== expected_hash)
                            throw new Error(`${algorithm}(${file}) = ${actual_hash} != ${expected_hash}`);
                    });
                }
            });
        },
        extract: function (archive, dest, { strip_components } = {}) {
            return step(`Extract ${archive}`, () => mkdirp(dest).then(() => tar.x({ file: archive, strip: strip_components, C: dest })));
        },
        download_and_extract: async function (url, archive, checksum, dest, { strip_components } = {}) {
            await this.download(url, archive);
            await this.checksum(archive, checksum);
            await this.extract(archive, dest, { strip_components });
        },
        cleanup: function (files) {
            return step('Cleanup', () => arrify(files).forEach(e => rimraf.sync(e)));
        },
        fetch_cmake3: async function ({ directory = default_vendor_dir, version, checksum } = {}) {
            const d = dependency('cmake3', { version, prefix: directory });
            const url = `https://github.com/Kitware/CMake/releases/download/v${d.version}/cmake-${d.version}-Linux-x86_64.tar.gz`;
            const archive = path.join(directory, `cmake-${d.version}-Linux-x86_64.tar.gz`);
            await step({
                title: 'Fetch CMake 3',
                skip: () => isDirectory(d.root) && (quiet || `${d.root} already exists`),
                action: async () => await this.download_and_extract(url, archive, checksum ?? d.checksum, d.root, { strip_components: 1 })
            });
            return d;
        },
        fetch_ittapi: async function ({ directory = default_vendor_dir, version, suffix, checksum, cmakeBuildType } = {}) {
            const d = dependency('ittapi', { version, prefix: directory, suffix });
            const dirs = d.build_directories();
            const url = `https://github.com/intel/ittapi/archive/${d.version}.tar.gz`;
            const archive = path.join(directory, `ittapi-${d.version}.tar.gz`);
            await step({
                title: 'Fetch ittapi',
                skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
                action: async () => {
                    await this.download_and_extract(url, archive, checksum ?? d.checksum, dirs.src, { strip_components: 1 });
                    await this.execa(cmake_configure_command(dirs.src, dirs.build, { buildType: cmakeBuildType, args: [] })),
                        await this.execa(cmake_build_command(dirs.build)),
                        step('Install', () => {
                            const headers = glob.sync(path.join(dirs.src, 'include', '**', '*.h?(pp)'));
                            install(headers, path.join(dirs.install, 'include'), { base: path.join(dirs.src, 'include') });
                            install(path.join(dirs.build, 'bin', 'libittnotify.a'), path.join(dirs.install, 'lib64'));
                        });
                    this.cleanup(dirs.temp);
                }
            });
            return d;
        },
        fetch_capstone: async function ({ directory = default_vendor_dir, version, suffix, checksum, cmakeBuildType } = {}) {
            const d = dependency('capstone', { version, prefix: directory, suffix });
            const dirs = d.build_directories();
            const url = `https://github.com/aquynh/capstone/archive/${d.version}.tar.gz`;
            const archive = path.join(directory, `capstone-${d.version}.tar.gz`);
            await step({
                title: 'Fetch capstone',
                skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
                action: async () => {
                    await this.download_and_extract(url, archive, checksum ?? d.checksum, dirs.src, { strip_components: 1 });
                    await this.execa(['patch', '-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'capstone-pkgconfig-includedir.diff')]);
                    await this.execa(cmake_configure_command(dirs.src, dirs.build, { buildType: cmakeBuildType, installPrefix: dirs.install, args: ['-DCAPSTONE_BUILD_TESTS=OFF'] }));
                    await this.execa(cmake_build_command(dirs.build, { target: 'install' }));
                    step('Drop dynamic libraries', () => {
                        glob.sync(path.join(dirs.install, 'lib', 'libcapstone.so*')).forEach(f => fs.rmSync(f));
                    });
                    this.cleanup(dirs.temp);
                }
            });
            return d;
        },
        fetch_glfw: async function ({ directory = default_vendor_dir, version, suffix, checksum, cmakeBuildType } = {}) {
            const d = dependency('glfw', { version, prefix: directory, suffix });
            const dirs = d.build_directories({});
            const url = `https://github.com/glfw/glfw/archive/${d.version}.tar.gz`;
            const archive = path.join(directory, `glfw-${d.version}.tar.gz`);
            await step({
                title: 'Fetch glfw',
                skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
                action: async () => {
                    await this.download_and_extract(url, archive, checksum ?? d.checksum, dirs.src, { strip_components: 1 });
                    await this.execa(cmake_configure_command(dirs.src, dirs.build, {
                        buildType: cmakeBuildType, installPrefix: dirs.install,
                        args: ['-DGLFW_BUILD_DOCS=OFF', '-DGLFW_BUILD_EXAMPLES=OFF', '-DGLFW_BUILD_TESTS=OFF']
                    }));
                    await this.execa(cmake_build_command(dirs.build, { target: 'install' }));
                    step('Fix pkgconfig file', () => {
                        sed(path.join(dirs.install, 'lib/pkgconfig/glfw3.pc'), 'Requires.private:  x11', 'Requires:  x11');
                    });
                    this.cleanup(dirs.temp);
                }
            });
            return d;
        },
        fetch_tracy: async function ({ directory = default_vendor_dir, version, suffix, checksum, components = [], withGlfw, withCapstone }) {
            const d = dependency('tracy', { version, prefix: directory, suffix });
            const dirs = d.build_directories({ buildInSource: true });
            const url = `https://github.com/wolfpld/tracy/archive/${d.version}.tar.gz`;
            const archive = path.join(directory, `tracy-${d.version}.tar.gz`);
            const buildStep = async (directory, { extra_pc_dirs = [], skip } = {}) => {
                const env = extra_pc_dirs.length === 0
                    ? undefined
                    : { PKG_CONFIG_PATH: extra_pc_dirs.concat((process.env.PKG_CONFIG_PATH || '').split(path.delimiter).filter(e => e)).join(path.delimiter) };
                return this.execa(['make', '-C', directory, '-j', `${nproc}`, 'release'], { env, skip });
            };
            const installHeaders = (...subdirs) => {
                const files = glob.sync(path.join(dirs.src, ...subdirs, '*.h?(pp)'));
                install(files, path.join(dirs.install, 'include', ...subdirs));
            };
            await step({
                title: 'Fetch tracy',
                skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
                action: async () => {
                    await this.download_and_extract(url, archive, checksum ?? d.checksum, dirs.src, { strip_components: 1 });
                    await this.execa(['patch', '-p1', '-d', dirs.src, '-i', path.join(__dirname, 'misc', 'tracy-pkgconfig-static.diff')], {
                        skip: () => !match_version(d.version, { range: '>=0.7 <=0.7.2' }) && (quiet || `Not required for version ${d.version}`)
                    });
                    step({
                        title: `Fix includes`,
                        skip: () => !match_version(d.version, { tag: 'master', range: '>=0.7.6' }) && (quiet || `Not required for version ${d.version}`),
                        action: () => {
                            ['TracyWorker.cpp', 'TracySourceView.cpp'].forEach(f => {
                                sed(path.join(dirs.src, 'server', f), 'capstone.h', 'capstone/capstone.h');
                            });
                        }
                    });
                    if (components.includes('lib')) {
                        await step('Build library', async () => {
                            const workdir = path.join(dirs.src, 'library', 'unix');
                            await buildStep(workdir);
                            step('Install library', () => {
                                install(path.join(workdir, 'libtracy-release.so'), path.join(dirs.install, 'lib'), { filename: 'libtracy.so' });
                                installHeaders();
                                installHeaders('client');
                                installHeaders('common');
                            });
                        });
                    }
                    if (components.includes('capture')) {
                        await step('Build capture tool', async () => {
                            const workdir = path.join(dirs.src, 'capture', 'build', 'unix');
                            await buildStep(workdir, { extra_pc_dirs: [withCapstone].filter(e => e).map(d => path.join(d, 'lib', 'pkgconfig')) });
                            step('Install capture', () => {
                                install(path.join(workdir, 'capture-release'), path.join(dirs.install, 'bin'), { filename: 'capture' });
                            });
                        });
                    }
                    if (components.includes('profiler')) {
                        await step('Build profiler', async () => {
                            const workdir = path.join(dirs.src, 'profiler', 'build', 'unix');
                            await buildStep(workdir, { extra_pc_dirs: [withCapstone, withGlfw].filter(e => e).map(d => path.join(d, 'lib', 'pkgconfig')) });
                            step('Install profiler', () => {
                                install(path.join(workdir, 'Tracy-release'), path.join(dirs.install, 'bin'), { filename: 'tracy' });
                            });
                        });
                    }
                    this.cleanup(dirs.temp);
                }
            });
            return d;
        },
        fetch_google_benchmark: async function ({ directory = default_vendor_dir, version, suffix, checksum, cmakeBuildType } = {}) {
            const d = dependency('google-benchmark', { version, prefix: directory, suffix });
            const dirs = d.build_directories({ buildInSource: true });
            const url = `https://github.com/google/benchmark/archive/${d.version}.tar.gz`;
            const archive = path.join(directory, `google-benchmark-${d.version}.tar.gz`);
            await step({
                title: 'Fetch google-benchmark',
                skip: () => isDirectory(dirs.install) && (quiet || `${dirs.install} already exists`),
                action: async () => {
                    await this.download_and_extract(url, archive, checksum ?? d.checksum, dirs.src, { strip_components: 1 });
                    await this.execa(cmake_configure_command(dirs.src, dirs.build, { buildType: cmakeBuildType, installPrefix: dirs.install, args: ['-DBENCHMARK_ENABLE_TESTING=OFF'] }));
                    await this.execa(cmake_build_command(dirs.build, { target: 'install' }));
                    this.cleanup(dirs.temp);
                }
            });
            return d;
        },
        build_instmt_examples: async function (build_dir, instrmt_dir, ittapi_root, tracy_root, { cmake, args } = {}) {
            const configure_command = cmake_configure_command(path.join(__dirname, 'example'), build_dir, {
                cmake,
                args: [...(args || []), `-DInstrmt_DIR=${instrmt_dir}`, `-DVTUNE_ROOT=${ittapi_root}`, `-DTRACY_ROOT=${tracy_root}`]
            });
            const build_command = cmake_build_command(build_dir, { cmake });
            await this.execa(configure_command);
            await this.execa(build_command);
        },
        verify_instrmt_cmake_integration: async function (workdir, instrmt_build_dir, instrmt_install_dir, ittapi_root, tracy_root, { cmake, args } = {}) {
            const build_examples = (build_dir, instrmt_dir) => this.build_instmt_examples(path.join(workdir, build_dir), instrmt_dir, ittapi_root, tracy_root, { cmake, args });
            await step('Check CMake build tree integration', () => build_examples('example-from-build', instrmt_build_dir));
            await step('Check CMake install tree integration', () => build_examples('example-from-install', path.join(instrmt_install_dir, 'share', 'cmake', 'instrmt')));
        }
    };
}
function absolute_path(p) { return path.resolve(p); }
const program = new commander.Command();
function FetchCommand(name, { pretty_name, version, suffix, checksum, cmakeBuildType } = {}) {
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
        assert(version, '"checkum" option requires "version" option');
        cmd.option('-c, --checksum <value>', 'Overrides checksum.');
        cmd.hook('preAction', (_, actionCommand) => {
            actionCommand.opts().checksum ??= dependency(name, { version: actionCommand.opts().version }).checksum;
        });
    }
    if (cmakeBuildType) {
        cmd.option('--cmake-build-type <value>', 'Overrides CMAKE_BUILD_TYPE.', 'Release');
    }
    return cmd;
}
FetchCommand('cmake3', { pretty_name: 'CMake 3.x', version: true, checksum: true })
    .action((options) => {
    steps(options).fetch_cmake3(options);
});
FetchCommand('ittapi', { pretty_name: 'ITT API', version: true, suffix: true, checksum: true, cmakeBuildType: true })
    .action((options) => {
    steps(options).fetch_ittapi(options);
});
FetchCommand('capstone', { pretty_name: 'Capstone', version: true, suffix: true, checksum: true, cmakeBuildType: true })
    .action((options) => {
    steps(options).fetch_capstone(options);
});
FetchCommand('glfw', { pretty_name: 'GLFW', version: true, suffix: true, checksum: true, cmakeBuildType: true })
    .action((options) => {
    steps(options).fetch_glfw(options);
});
FetchCommand('tracy', { pretty_name: 'Tracy', version: true, suffix: true, checksum: true })
    .addOption(new commander.Option('--components <value...>', 'Components to build.').choices(['lib', 'capture', 'profiler']).default(['lib']))
    .option('--with-glfw <directory>', 'Root directory of glfw (location of lib/pkgconfig/glfw3.pc).')
    .hook('preAction', (_, actionCommand) => {
    actionCommand.opts().withGlfw ??= dependency('glfw', { prefix: actionCommand.opts().directory }).root;
})
    .option('--with-capstone <directory>', 'Root directory of capstone (location of lib/pkgconfig/capstone.pc).')
    .hook('preAction', (_, actionCommand) => {
    actionCommand.opts().withCapstone ??= dependency('capstone', { prefix: actionCommand.opts().directory }).root;
})
    .action((options) => {
    steps(options).fetch_tracy(options);
});
FetchCommand('google-benchmark', { version: true, suffix: true, checksum: true, cmakeBuildType: true })
    .action((options) => {
    steps(options).fetch_google_benchmark(options);
});
program
    .command('setup')
    .description('Fetch dependencies.')
    .option('-C, --directory <directory>', 'Change to DIR before performing any operations.', absolute_path, default_vendor_dir)
    .option('-q, --quiet', 'Hide non-essential messages (e.g. only display external commands output if they fail).')
    .action(async (options) => {
    const directory = options.directory;
    await steps(options).fetch_ittapi({ directory, cmakeBuildType: 'Release' });
    await steps(options).fetch_tracy({ directory, components: ['lib'] });
    await steps(options).fetch_google_benchmark({ directory, cmakeBuildType: 'Release' });
});
async function start_ci_container(options) {
    const branch = execa.sync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.toString();
    execa.sync('docker', ['volume', 'create', 'instrmt-build-cache']);
    const step_exe = options.quiet ? `step -q` : `step`;
    const commands = [
        `${step_exe} git clone --depth 1 -b ${branch} /repo /src`,
        `${step_exe} mkdir -p /cache/node_modules /cache/vendor`,
        `${step_exe} ln -snf /cache/vendor /src/vendor`,
        `${step_exe} rsync -a /cache/node_modules/ /src/node_modules/`,
        `${step_exe} npm i --production --prefer-offline --no-audit --progress=false`,
        `${step_exe} rsync -a /src/node_modules/ /cache/node_modules/`,
        shellquote.quote([
            'step', 'node', 'bootstrap.js', 'ci',
            ...dargs(options, { includes: ['quiet'], ignoreFalse: true }),
            ...dargs(options, { includes: ['werror'], ignoreTrue: true }),
            ...dargs(options, { includes: ['compiler', 'cmakeVersion', 'ittapiVersion', 'tracyVersion', 'googleBenchmarkVersion'] }),
        ])
    ];
    let command_string = commands.join(' && ');
    if (options.shell) {
        if (!isInteractive())
            throw new Error('Host terminal is not a TTY, the --shell option cannot be used.');
        command_string = `${command_string} ; bash`;
    }
    const shellFlags = function* () {
        if (options.shell)
            yield '-i';
        if (options.shell || isInteractive())
            yield '-t';
    };
    const docker_command = [
        'docker', 'run', '--rm', ...shellFlags(), '-v', `${__dirname}:/repo:ro`, '--mount', 'source=instrmt-build-cache,target=/cache',
        'instrmt-build',
        'bash', '-c', command_string
    ];
    await step(shellquote.quote(docker_command), () => execa(docker_command[0], docker_command.slice(1), { stdio: 'inherit' })
        .catch(err => { throw new Error(`Command failed with exit code ${err.exitCode}`); }));
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
    return step('CI', async () => {
        const ittapi = await steps(options).fetch_ittapi({ version: options.ittapiVersion });
        const tracy = await steps(options).fetch_tracy({ version: options.tracyVersion, components: ['lib'] });
        const google_benchmark = await steps(options).fetch_google_benchmark({ version: options.googleBenchmarkVersion });
        if (options.cmakeVersion) {
            const cmake3 = await steps(options).fetch_cmake3({ version: options.cmakeVersion === true ? dependency('cmake3').version : options.cmakeVersion });
            prependPath(path.join(cmake3.root, 'bin'));
        }
        await steps(options).withTempdir(path.join(os.tmpdir(), 'instrmt-'), async (tempdir) => {
            const instrmt_bld = path.join(tempdir, 'instrmt-build');
            const instrmt_dist = path.join(tempdir, 'instrmt-install');
            const cmake_compiler_options = options.compiler ? [`-DCMAKE_CXX_COMPILER=${options.compiler.replace('gcc', 'g++').replace('clang', 'clang++')}`] : [];
            await steps(options).execa(['cmake', '--version']);
            await steps(options).execa(cmake_configure_command(__dirname, instrmt_bld, {
                buildType: 'Release', installPrefix: instrmt_dist, args: [
                    ...cmake_compiler_options,
                    '-DINSTRMT_BUILD_ITT_ENGINE=ON', `-DVTUNE_ROOT=${ittapi.root}`,
                    '-DINSTRMT_BUILD_TRACY_ENGINE=ON', `-DTRACY_ROOT=${tracy.root}`,
                    '-DBUILD_BENCHMARKS=ON', `-Dbenchmark_DIR=${path.join(google_benchmark.root, 'lib', 'cmake', 'benchmark')}`,
                    '-DBUILD_TESTING=ON', ...(options.werror ? ['-DCMAKE_CXX_FLAGS=-Werror'] : [])
                ]
            }));
            await steps(options).execa(cmake_build_command(instrmt_bld, { target: 'install' }));
            await steps(options).execa(['ctest'], { cwd: instrmt_bld });
            await steps(options).verify_instrmt_cmake_integration(tempdir, instrmt_bld, instrmt_dist, ittapi.root, tracy.root, { args: cmake_compiler_options });
        });
    });
});
program.parseAsync(process.argv)
    .catch(err => {
    console.error(err);
    process.exitCode = -1;
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYm9vdHN0cmFwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYm9vdHN0cmFwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUNBLE9BQU8sS0FBSyxZQUFZLE1BQU0sY0FBYyxDQUFDO0FBQzdDLFlBQVksQ0FBQyxTQUFTLEVBQUUsQ0FBQztBQUV6QixPQUFPLE1BQU0sTUFBTSxRQUFRLENBQUM7QUFDNUIsT0FBTyxNQUFNLE1BQU0sUUFBUSxDQUFDO0FBQzVCLE9BQU8sU0FBUyxNQUFNLFdBQVcsQ0FBQztBQUNsQyxPQUFPLEtBQUssTUFBTSxPQUFPLENBQUM7QUFDMUIsT0FBTyxLQUFLLE1BQU0sT0FBTyxDQUFDO0FBQzFCLE9BQU8sRUFBRSxNQUFNLElBQUksQ0FBQztBQUNwQixPQUFPLEtBQUssR0FBRyxNQUFNLFVBQVUsQ0FBQztBQUNoQyxPQUFPLElBQUksTUFBTSxNQUFNLENBQUM7QUFDeEIsT0FBTyxHQUFHLE1BQU0sS0FBSyxDQUFDO0FBQ3RCLE9BQU8sYUFBYSxNQUFNLGdCQUFnQixDQUFDO0FBQzNDLE9BQU8sTUFBTSxNQUFNLFFBQVEsQ0FBQztBQUM1QixPQUFPLEtBQUssTUFBTSxPQUFPLENBQUM7QUFDMUIsT0FBTyxNQUFNLE1BQU0sUUFBUSxDQUFDO0FBQzVCLE9BQU8sRUFBRSxNQUFNLElBQUksQ0FBQztBQUNwQixPQUFPLElBQUksTUFBTSxNQUFNLENBQUM7QUFDeEIsT0FBTyxZQUFZLE1BQU0sZ0JBQWdCLENBQUM7QUFDMUMsT0FBTyxFQUFFLFNBQVMsRUFBRSxNQUFNLE1BQU0sQ0FBQztBQUNqQyxPQUFPLGFBQXNDLE1BQU0saUJBQWlCLENBQUM7QUFDckUsT0FBTyxNQUFNLE1BQU0sUUFBUSxDQUFDO0FBQzVCLE9BQU8sTUFBTSxNQUFNLFFBQVEsQ0FBQztBQUM1QixPQUFPLFVBQVUsTUFBTSxhQUFhLENBQUM7QUFDckMsT0FBTyxNQUFNLE1BQU0sUUFBUSxDQUFDO0FBQzVCLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FB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