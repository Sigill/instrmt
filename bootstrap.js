import * as global_agent from 'global-agent';
global_agent.bootstrap();
import arrify from 'arrify';
import assert from 'assert';
import * as commander from 'commander';
import dargs from 'dargs';
import { execa, execaSync } from 'execa';
import fs from 'fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fse = require('fs-extra');
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
        versions: {
            '3.21.2': { checksum: 'md5:68d783b7a6c3ea4d2786cf157f9a6d29' }
        }
    },
    ittapi: {
        default_version: '8cd2618',
        versions: {
            '8cd2618': { checksum: 'md5:5920c512a7a7c8971f2ffe6f693ffff3' }
        }
    },
    capstone: {
        default_version: '4.0.2',
        versions: {
            '4.0.2': { checksum: 'md5:8894344c966a948f1248e66c91b53e2c' }
        }
    },
    glfw: {
        default_version: '3.3.4',
        versions: {
            '3.3.4': { checksum: 'md5:8f8e5e931ef61c6a8e82199aabffe65a' }
        }
    },
    tracy: {
        default_version: 'v0.7.6',
        versions: {
            'v0.7.2': { checksum: 'md5:bceb615c494c3f7ccb77ba3bae20b216' },
            'v0.7.6': { checksum: 'md5:828be21907a1bddf5762118cf9e3ff66' }
        }
    },
    'google-benchmark': {
        default_version: 'v1.5.3',
        versions: {
            'v1.5.3': { checksum: 'md5:abb43ef7784eaf0f7a98aed560920f46' }
        }
    }
};
function dependency(name, { version, suffix, prefix = default_vendor_dir } = {}) {
    version ||= dependencies[name].default_version;
    const basename = [dependencies[name].basename || name, pretty_version(version), suffix].filter(e => e).join('-');
    const root = path.join(prefix, basename);
    const checksum = dependencies[name].versions?.[version]?.checksum;
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
                .then(args => { this.cleanup(tempdir); return args; }, (err) => { this.cleanup(tempdir); throw err; })
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
                action: async () => {
                    const [algorithm, expected_hash] = expected_checksum.split(':', 2);
                    const actual_hash = await hasha.fromFile(file, { algorithm });
                    if (actual_hash !== expected_hash)
                        throw new Error(`${algorithm}(${file}) = ${actual_hash} != ${expected_hash}`);
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
            const dirs = d.build_directories();
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
function ensureChecksum(value) {
    if (['md5', 'sha1', 'sha256', 'sha512'].some(a => value.startsWith(`${a}:`)))
        return value;
    throw new commander.InvalidArgumentError(`Invalid checksum syntax`);
}
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
        assert(version, '"checksum" option requires "version" option');
        cmd.option('-c, --checksum <value>', 'Overrides checksum.', ensureChecksum, undefined);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYm9vdHN0cmFwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYm9vdHN0cmFwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUNBLE9BQU8sS0FBSyxZQUFZLE1BQU0sY0FBYyxDQUFDO0FBQzdDLFlBQVksQ0FBQyxTQUFTLEVBQUUsQ0FBQztBQUV6QixPQUFPLE1BQU0sTUFBTSxRQUFRLENBQUM7QUFDNUIsT0FBTyxNQUFNLE1BQU0sUUFBUSxDQUFDO0FBQzVCLE9BQU8sS0FBSyxTQUFTLE1BQU0sV0FBVyxDQUFDO0FBQ3ZDLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQztBQUMxQixPQUFPLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxNQUFNLE9BQU8sQ0FBQztBQUN6QyxPQUFPLEVBQUUsTUFBTSxJQUFJLENBQUM7QUFJcEIsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLGFBQWEsQ0FBQztBQUM1QyxNQUFNLE9BQU8sR0FBRyxhQUFhLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUMvQyxNQUFNLEdBQUcsR0FBRyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUM7QUFFaEMsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFDO0FBQ3hCLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQztBQUN0QixPQUFPLGFBQWEsTUFBTSxnQkFBZ0IsQ0FBQztBQUMzQyxPQUFPLEtBQUssTUFBTSxPQUFPLENBQUM7QUFDMUIsT0FBTyxLQUFLLE1BQU0sT0FBTyxDQUFDO0FBQzFCLE9BQU8sTUFBTSxNQUFNLFFBQVEsQ0FBQztBQUM1QixPQUFPLEVBQUUsTUFBTSxJQUFJLENBQUM7QUFDcEIsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFDO0FBQ3hCLE9BQU8sWUFBWSxNQUFNLGdCQUFnQixDQUFDO0FBQzFDLE9BQU8sRUFBRSxTQUFTLEVBQUUsTUFBTSxNQUFNLENBQUM7QUFDakMsT0FBTyxhQUFzQyxNQUFNLGlCQUFpQixDQUFDO0FBQ3JFLE9BQU8s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