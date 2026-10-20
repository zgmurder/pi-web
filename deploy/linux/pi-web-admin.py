#!/usr/bin/env python3
"""Single-host Pi Web releases. Python standard library + git/npm/systemd only."""
import argparse
import base64
import contextlib
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import pwd
import re
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path('/srv/pi-web')
CONFIG = Path('/etc/pi-web')
NODE = '/usr/bin/node'
NAME = re.compile(r'[a-z][a-z0-9-]{0,23}\Z')
RELEASE = re.compile(r'[0-9a-f]{12}-[0-9]{14}-[0-9a-f]{8}\Z')
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def log(message):
    print(f'[pi-web-admin] {message}', flush=True)


def run(*args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def output(*args, **kwargs):
    return run(*args, stdout=subprocess.PIPE, text=True, **kwargs).stdout.strip()


def valid_name(name):
    if not NAME.fullmatch(name):
        raise ValueError('Name must start with a lowercase letter, use a-z/0-9/hyphens, max 24 characters')
    return name


def release_path(release):
    if not RELEASE.fullmatch(release):
        raise ValueError('Invalid release ID')
    return ROOT / 'releases' / release


def require_root_controlled(path):
    """An immutable child is not safe under a user-replaceable parent."""
    for item in (path, *path.parents):
        if item.is_symlink():
            raise ValueError(f'Unsafe admin directory: {item}')
        if item.exists():
            info = item.stat()
            if info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError(f'Unsafe admin directory: {item}')


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def metadata(source):
    data = json.loads((source / 'release.json').read_text())
    release_path(data['id'])
    if data['platform'] != 'Linux' or data['arch'] != platform.machine():
        raise ValueError('Release platform/architecture does not match this host')
    if data['node'] != output(NODE, '--version'):
        raise ValueError('Build and runtime must use the exact same /usr/bin/node version')
    if not re.fullmatch(r'[0-9a-f]{40}', data['commit']):
        raise ValueError('Invalid commit')
    for name in ('.next/BUILD_ID', '.next/prerender-manifest.json', 'package.json',
                 'node_modules/next/dist/bin/next', 'bin/rotate-preview-secrets.js'):
        if not (source / name).is_file():
            raise ValueError(f'Missing runtime file: {name}')
    if (source / '.next/BUILD_ID').read_text().strip() != data['buildId']:
        raise ValueError('Build ID does not match release metadata')
    return data


def validate_tree(source):
    """Keep npm's internal symlinks, but never import a link outside the release."""
    source = source.resolve(strict=True)
    for directory, dirs, files in os.walk(source, followlinks=False):
        for name in dirs + files:
            item = Path(directory) / name
            mode = item.lstat().st_mode
            if stat.S_ISLNK(mode):
                if not item.resolve(strict=True).is_relative_to(source):
                    raise ValueError(f'External release symlink: {item.relative_to(source)}')
                if os.path.isabs(os.readlink(item)):
                    raise ValueError('Release symlinks must be relative for relocation')
            elif not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise ValueError(f'Unsupported release entry: {item}')
    for name in ('.git', '.pi', '.agents'):
        if (source / name).exists():
            raise ValueError(f'Private source directory in release: {name}')
    if list(source.glob('.env*')):
        raise ValueError('Environment files must not be included in releases')


def normalize_permissions(root):
    for directory, dirs, files in os.walk(root, followlinks=False):
        Path(directory).chmod(0o755)
        for name in files:
            path = Path(directory) / name
            if not path.is_symlink():
                path.chmod(0o755 if path.stat().st_mode & 0o111 else 0o644)


def build(args):
    if os.geteuid() == 0:
        raise ValueError('Build as a dedicated unprivileged builder, never as root')
    destination = Path(args.output).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='pi-web-build-') as temporary:
        work = Path(temporary) / 'source'
        # A fresh clone excludes the developer worktree, .env.local and .next/dev.
        run('git', 'clone', '--no-hardlinks', '--no-checkout', '--', args.repo, work)
        commit = output('git', '-C', work, 'rev-parse', '--verify', '--end-of-options', args.commit + '^{commit}')
        run('git', '-C', work, 'checkout', '--detach', commit)
        if list(work.glob('.env*')) or any((work / p).exists() for p in ('.pi', '.agents')):
            raise ValueError('Refusing a source commit containing local env/project-agent configuration')
        # Do not inject the developer's model credentials, NODE_OPTIONS or Pi settings into a build.
        home = Path(temporary) / 'home'
        home.mkdir()
        env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(home),
               'LANG': 'C.UTF-8', 'CI': '1', 'NEXT_TELEMETRY_DISABLED': '1', 'PI_OFFLINE': '1',
               'PI_SKIP_VERSION_CHECK': '1', 'PI_TELEMETRY': '0'}
        if args.npm_cache:
            env['npm_config_cache'] = str(Path(args.npm_cache).resolve())
        if args.registry:
            env['npm_config_registry'] = args.registry
        if output('node', '--version', env=env) != output(NODE, '--version'):
            raise ValueError('PATH node must match /usr/bin/node')
        npm = ['npm', 'ci', '--include=dev', '--no-audit', '--no-fund']
        if args.offline:
            npm.append('--offline')
        run(*npm, cwd=work, env=env)
        for command in ([NODE, 'node_modules/typescript/bin/tsc', '--noEmit'],
                        ['npm', 'test'], ['npm', 'run', 'lint'], ['npm', 'run', 'build']):
            log('Running ' + ' '.join(command))
            # Unit tests mock update commands; offline mode would bypass those assertions.
            command_env = {**env, 'PI_OFFLINE': '0'} if command == ['npm', 'test'] else env
            run(*command, cwd=work, env=command_env)
        release = commit[:12] + '-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S') + '-' + secrets.token_hex(4)
        target = destination / release
        pending = destination / ('.' + release)
        pending.mkdir()
        try:
            for name in ('.next', 'node_modules', 'bin', 'public'):
                shutil.copytree(work / name, pending / name, symlinks=True)
            for name in ('package.json', 'package-lock.json', 'next.config.ts', 'LICENSE'):
                shutil.copy2(work / name, pending / name)
            (pending / 'lib').mkdir()
            shutil.copy2(work / 'lib/gfm-autolink-email-loader.cjs', pending / 'lib')
            for name in ('.next/cache', '.next/dev'):
                shutil.rmtree(pending / name, ignore_errors=True)
            write_json(pending / 'release.json', {
                'id': release, 'commit': commit, 'node': output(NODE, '--version'),
                'platform': platform.system(), 'arch': platform.machine(),
                'buildId': (pending / '.next/BUILD_ID').read_text().strip(),
                'lockSha256': hashlib.sha256((work / 'package-lock.json').read_bytes()).hexdigest(),
            })
            validate_tree(pending)
            normalize_permissions(pending)
            pending.rename(target)
        except BaseException:
            shutil.rmtree(pending, ignore_errors=True)
            raise
    log(f'Built {target}; not deployed. Review and publish explicitly.')


def publish(source):
    source = Path(source).resolve(strict=True)
    validate_tree(source)
    data = metadata(source)
    target = release_path(data['id'])
    if target.exists():
        raise ValueError('Release already published; never overwrite it')
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix='.publish-', dir=target.parent) as temporary:
        stage = Path(temporary) / 'app'
        shutil.copytree(source, stage, symlinks=True)
        validate_tree(stage)
        metadata(stage)
        normalize_permissions(stage)
        stage.rename(target)
    log(f'Published {data["id"]}; instances unchanged')


def config(name):
    return json.loads((CONFIG / (valid_name(name) + '.json')).read_text())


def unit(name):
    return 'pi-web@' + valid_name(name) + '.service'


def set_link(link, target):
    temporary = link.with_name(link.name + '.new')
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    temporary.replace(link)


def link_release(instance, name):
    link = instance / name
    if not link.is_symlink():
        return None
    target = link.resolve(strict=True)
    if target.parent != instance / 'releases' or not RELEASE.fullmatch(target.name):
        raise ValueError(f'Invalid {name} link')
    return target.name


def stage_instance(name, release):
    source = release_path(release)
    metadata(source)
    account = pwd.getpwnam('pi-' + name)
    instance = ROOT / 'instances' / name
    target = instance / 'releases' / release
    if target.is_symlink():
        raise ValueError('Instance release must not be a symlink')
    if target.exists():
        return target
    with tempfile.TemporaryDirectory(prefix='.stage-', dir=instance) as temporary:
        stage = Path(temporary) / 'app'
        shutil.copytree(source, stage, symlinks=True)
        # No writable hardlinks: .next (including preview secrets) belongs to this user alone.
        for directory, dirs, files in os.walk(stage / '.next', followlinks=False):
            os.chown(directory, account.pw_uid, account.pw_gid)
            os.chmod(directory, 0o700)
            for file in files:
                path = Path(directory) / file
                if path.is_symlink():
                    raise ValueError('Next build must not contain file symlinks')
                os.chown(path, account.pw_uid, account.pw_gid)
                path.chmod(0o600)
            if any((Path(directory) / d).is_symlink() for d in dirs):
                raise ValueError('Next build must not contain directory symlinks')
        stage.rename(target)
    return target


def api(settings, path, authenticated=True):
    headers = {}
    if authenticated:
        # Env files are generated here with a hex password, not sourced as shell code.
        text = (CONFIG / (settings['name'] + '.env')).read_text()
        match = re.search(r'^PI_WEB_PASSWORD=([0-9a-f]{64})$', text, re.M)
        if not match:
            raise ValueError('Missing/invalid generated instance password')
        headers['Authorization'] = 'Basic ' + base64.b64encode(('pi:' + match[1]).encode()).decode()
    request = urllib.request.Request(f'http://127.0.0.1:{settings["port"]}{path}', headers=headers)
    with HTTP.open(request, timeout=3) as response:
        return json.load(response)


def healthy(settings, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            auth = api(settings, '/api/web-auth')
            if auth.get('enabled') is not True or auth.get('authenticated') is not True:
                raise ValueError('Instance authentication is not enabled/working')
            anonymous = api(settings, '/api/web-auth', authenticated=False)
            if anonymous.get('authenticated') is not False:
                raise ValueError('Anonymous authentication unexpectedly succeeded')
            try:
                api(settings, '/api/sessions', authenticated=False)
            except urllib.error.HTTPError as error:
                if error.code != 401:
                    raise
            else:
                raise ValueError('Unauthenticated session access was not refused')
            running = api(settings, '/api/agent/running')
            if not isinstance(running.get('runningSessionIds'), list):
                raise ValueError('Agent endpoint returned invalid data')
            market = api(settings, '/api/market')
            if market.get('diagnostics') != []:
                raise ValueError('Market diagnostics are not empty')
            return
        except (OSError, ValueError):
            time.sleep(1)
    raise RuntimeError('Health check failed (auth, sessions, agent and market); inspect journalctl')


def activate(name, release):
    settings = config(name)
    instance = ROOT / 'instances' / name
    old = link_release(instance, 'current')
    if old == release:
        log(f'{name}: already on {release}; checking health')
        healthy(settings)
        return
    target = stage_instance(name, release)
    was_active = subprocess.run(['systemctl', 'is-active', '--quiet', unit(name)]).returncode == 0
    log(f'{name}: stopping service, switching {old or "uninstalled"} -> {release}')
    run('systemctl', 'stop', unit(name))
    try:
        set_link(instance / 'current', target)
        run('systemctl', 'start', unit(name))
        healthy(settings)
    except BaseException:
        log(f'{name}: update failed; stopping candidate and restoring previous link')
        run('systemctl', 'stop', unit(name))
        if old:
            set_link(instance / 'current', instance / 'releases' / old)
            if was_active:
                run('systemctl', 'start', unit(name))
                healthy(settings)
                log(f'{name}: previous version restored and healthy')
        else:
            (instance / 'current').unlink(missing_ok=True)
        raise
    if old:
        set_link(instance / 'previous', instance / 'releases' / old)
    log(f'{name}: healthy on {release}')


def create(args):
    name = valid_name(args.name)
    metadata(release_path(args.release))
    if not 1024 <= args.port <= 65535:
        raise ValueError('Port must be between 1024 and 65535')
    if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', args.host) or len(args.host) > 253:
        raise ValueError('Use one lowercase DNS hostname without scheme, port or wildcard')
    market = Path(args.market).resolve(strict=True)
    require_root_controlled(market)
    if not re.fullmatch(r'/[a-zA-Z0-9_./-]+', str(market)) or not market.is_dir():
        raise ValueError('Market must be an existing absolute directory without spaces')
    # Refuse a market writable by a non-root account, including symlinked content.
    for directory, dirs, files in os.walk(market, followlinks=False):
        for path in [Path(directory)] + [Path(directory) / p for p in dirs + files]:
            info = path.lstat()
            if path.is_symlink() or info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError(f'Market must be root-owned, not group/world-writable, and have no symlinks: {path}')
    for path in CONFIG.glob('*.json'):
        other = json.loads(path.read_text())
        if other['port'] == args.port or other['host'] == args.host:
            raise ValueError('Port or hostname is already assigned')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', args.port))
    home = Path('/home/pi-' + name)
    instance = ROOT / 'instances' / name
    if (CONFIG / (name + '.json')).exists() or instance.exists() or home.exists():
        raise ValueError('Instance/home already exists; refusing to overwrite')
    try:
        pwd.getpwnam('pi-' + name)
    except KeyError:
        pass
    else:
        raise ValueError('System account already exists; refusing to reuse it')
    run('useradd', '--create-home', '--user-group', '--home-dir', home,
        '--shell', '/usr/sbin/nologin', 'pi-' + name)
    account = pwd.getpwnam('pi-' + name)
    home.chmod(0o700)
    for relative in ('.pi/agent', 'pi-cwd'):
        path = home / relative
        path.mkdir(parents=True, mode=0o700)
    for directory, dirs, files in os.walk(home):
        os.chown(directory, account.pw_uid, account.pw_gid)
    instance.parent.mkdir(parents=True, exist_ok=True)
    instance.parent.chmod(0o755)
    instance.mkdir(mode=0o750)
    instance.chmod(0o750)
    os.chown(instance, 0, account.pw_gid)
    (instance / 'releases').mkdir(mode=0o755)
    (instance / 'releases').chmod(0o755)
    settings = {'name': name, 'port': args.port, 'host': args.host, 'market': str(market)}
    write_json(CONFIG / (name + '.json'), settings)
    environment = '\n'.join([
        f'HOME={home}', 'SHELL=/bin/bash', f'PI_CODING_AGENT_DIR={home}/.pi/agent',
        f'PI_WEB_PORT={args.port}', f'PI_WEB_ALLOWED_HOSTS={args.host}',
        f'PI_WEB_MARKET_DIR={market}', f'PI_WEB_PASSWORD={secrets.token_hex(32)}',
        'NODE_ENV=production', 'NEXT_TELEMETRY_DISABLED=1', 'PI_TELEMETRY=0',
        'PI_OFFLINE=1', 'PI_SKIP_VERSION_CHECK=1', 'PI_WEB_SKIP_VERSION_CHECK=1', '',
    ])
    (CONFIG / (name + '.env')).write_text(environment)
    (CONFIG / (name + '.env')).chmod(0o600)
    log(f'{name}: account/config created. On failure they are retained; never delete user data automatically.')
    activate(name, args.release)
    run('systemctl', 'enable', unit(name))
    log(f'{name}: ready for HTTPS proxy at {args.host}; password is in root-only {CONFIG / (name + ".env")}')


@contextlib.contextmanager
def admin_lock():
    if os.geteuid() != 0:
        raise ValueError('Instance management requires root; never grant this command to ordinary users')
    # Standard root-owned paths only; no env override that could redirect privileged writes.
    for path in (ROOT, CONFIG, ROOT / 'releases', ROOT / 'instances'):
        require_root_controlled(path)
        path.mkdir(parents=True, exist_ok=True)
        path.chmod(0o755 if path in (ROOT, ROOT / 'instances') else 0o700)
    with (CONFIG / 'admin.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    sub = result.add_subparsers(dest='command', required=True)
    p = sub.add_parser('build', help='Build an exact commit as an unprivileged builder')
    p.add_argument('--repo', required=True)
    p.add_argument('--commit', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--npm-cache')
    p.add_argument('--registry')
    p.add_argument('--offline', action='store_true')
    p = sub.add_parser('publish', help='Import a reviewed build directory as root')
    p.add_argument('directory')
    p = sub.add_parser('create')
    p.add_argument('name')
    p.add_argument('--port', required=True, type=int)
    p.add_argument('--host', required=True)
    p.add_argument('--market', required=True)
    p.add_argument('--release', required=True)
    p = sub.add_parser('deploy')
    target = p.add_mutually_exclusive_group(required=True)
    target.add_argument('--name')
    target.add_argument('--all', action='store_true')
    p.add_argument('--release', required=True)
    p.add_argument('--maintenance-confirmed', required=True, action='store_true',
                   help='Operator has checked jobs/terminals, arranged downtime and backed up private data')
    p = sub.add_parser('rollback')
    p.add_argument('name')
    p.add_argument('--maintenance-confirmed', required=True, action='store_true')
    sub.add_parser('status')
    return result


def main():
    args = parser().parse_args()
    if platform.system() != 'Linux':
        raise ValueError('Linux with systemd is required')
    os.umask(0o077)
    if args.command == 'build':
        build(args)
        return
    with admin_lock():
        if args.command == 'publish':
            publish(args.directory)
        elif args.command == 'create':
            create(args)
        elif args.command == 'deploy':
            metadata(release_path(args.release))
            names = [valid_name(args.name)] if args.name else sorted(p.stem for p in CONFIG.glob('*.json'))
            for name in names:
                if args.all and subprocess.run(['systemctl', 'is-active', '--quiet', unit(name)]).returncode != 0:
                    log(f'{name}: skipped inactive service; use --name to deploy/start explicitly')
                    continue
                activate(name, args.release)
        elif args.command == 'rollback':
            name = valid_name(args.name)
            previous = link_release(ROOT / 'instances' / name, 'previous')
            if not previous:
                raise ValueError('No previous release')
            activate(name, previous)
        elif args.command == 'status':
            for file in sorted(CONFIG.glob('*.json')):
                data = config(file.stem)
                current = link_release(ROOT / 'instances' / file.stem, 'current')
                state = subprocess.run(['systemctl', 'is-active', unit(file.stem)],
                                       capture_output=True, text=True).stdout.strip()
                log(f'{file.stem}\tport={data["port"]}\t{state}\trelease={current or "none"}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.CalledProcessError) as error:
        log(f'ERROR: {error}')
        sys.exit(1)
