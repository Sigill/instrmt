import * as global_agent from 'global-agent';
global_agent.bootstrap();
import arrify from 'arrify';
import assert from 'assert';
import * as commander from 'commander';
import dargs from 'dargs';
import { execa, execaSync } from 'execa';
import fs from 'fs';
import * as fse from 'fs-extra';
import glob from 'glob';
import got from 'got';
import isInteractive from 'is-interactive';
import which from 'which';
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
    if (which.sync('unbuffer')) {
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
    const branch = execaSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.toString();
    execaSync('docker', ['volume', 'create', 'instrmt-build-cache']);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYm9vdHN0cmFwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYm9vdHN0cmFwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUNBLE9BQU8sS0FBSyxZQUFZLE1BQU0sY0FBYyxDQUFDO0FBQzdDLFlBQVksQ0FBQyxTQUFTLEVBQUUsQ0FBQztBQUV6QixPQUFPLE1BQU0sTUFBTSxRQUFRLENBQUM7QUFDNUIsT0FBTyxNQUFNLE1BQU0sUUFBUSxDQUFDO0FBQzVCLE9BQU8sS0FBSyxTQUFTLE1BQU0sV0FBVyxDQUFDO0FBQ3ZDLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQztBQUMxQixPQUFPLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxNQUFNLE9BQU8sQ0FBQztBQUN6QyxPQUFPLEVBQUUsTUFBTSxJQUFJLENBQUM7QUFDcEIsT0FBTyxLQUFLLEdBQUcsTUFBTSxVQUFVLENBQUM7QUFDaEMsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFDO0FBQ3hCLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQztBQUN0QixPQUFPLGFBQWEsTUFBTSxnQkFBZ0IsQ0FBQztBQUMzQyxPQUFPLEtBQUssTUFBTSxPQUFPLENBQUM7QUFDMUIsT0FBTyxLQUFLLE1BQU0sT0FBTyxDQUFDO0FBQzFCLE9BQU8sTUFBTSxNQUFNLFFBQVEsQ0FBQztBQUM1QixPQUFPLEVBQUUsTUFBTSxJQUFJLENBQUM7QUFDcEIsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFDO0FBQ3hCLE9BQU8sWUFBWSxNQUFNLGdCQUFnQixDQUFDO0FBQzFDLE9BQU8sRUFBRSxTQUFTLEVBQUUsTUFBTSxNQUFNLENBQUM7QUFDakMsT0FBTyxhQUFzQyxNQUFNLGlCQUFpQixDQUFDO0FBQ3JFLE9BQU8sTUFBTSxNQUFNLFFBQVEsQ0FBQztBQUM1QixPQUFPLE1BQU0sTUFBTSxRQUFRLENBQUM7QUFDNUIsT0FBTyxVQUFVLE1BQU0sYUFBYSxDQUFDO0FBQ3JDLE9BQU8sTUFBTSxNQUFNLFFBQVEsQ0FBQztBQUM1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