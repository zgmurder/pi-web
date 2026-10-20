#!/usr/bin/env python3
"""Build committed HEAD in Linux Docker; stage one archive in the private release Git checkout."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

RELEASE_REMOTE = 'ssh://admin@192.168.31.98:29418/~admin/pi-web-releases.git'
IMAGE = 'pi-web-builder:node22.19.0'


def run(*args, **kwargs):
    print('[release] ' + ' '.join(str(a) for a in args), flush=True)
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def git_output(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()


def check_repository(source, destination):
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError('Source and release checkout must be separate, non-nested directories')
    if Path(git_output(destination, 'rev-parse', '--show-toplevel')).resolve() != destination:
        raise ValueError('Output must be the release checkout root')
    if git_output(destination, 'remote', 'get-url', 'origin') != RELEASE_REMOTE:
        raise ValueError('Output origin must be the private pi-web-releases repository')
    if git_output(destination, 'status', '--porcelain'):
        raise ValueError('Commit or remove pending release changes before building')


def stage_archive(archive, manifest, destination, commit):
    data = json.loads(manifest.read_text(encoding='utf-8'))
    if data['commit'] != commit or data['platform'] != 'Linux' or data['arch'] != 'x86_64':
        raise ValueError('Unexpected build commit or platform')
    if data['node'] != 'v22.19.0':
        raise ValueError('Unexpected build Node version')
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    # Only completed builds replace the staged release; Git commits publish all three files together.
    os.replace(archive, destination / 'pi-web-linux-x64.tar.gz')
    os.replace(manifest, destination / 'release.json')
    (destination / 'SHA256SUMS').write_text(
        digest + '  pi-web-linux-x64.tar.gz\n', encoding='ascii')


def main():
    source = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-repo', type=Path, default=source.parent / 'pi-web-releases')
    args = parser.parse_args()
    destination = args.release_repo.resolve(strict=True)
    check_repository(source, destination)
    commit = git_output(source, 'rev-parse', 'HEAD')
    print(f'[release] Building committed HEAD {commit}; uncommitted application changes are excluded.', flush=True)
    tools = Path(__file__).resolve().parent
    run('docker', 'build', '--platform', 'linux/amd64', '-t', IMAGE,
        '-f', tools / 'Dockerfile.builder', tools)
    # The container receives a Git bundle, not the worktree, .env files, credentials or Docker socket.
    with tempfile.TemporaryDirectory(prefix='.build-', dir=destination) as directory:
        temporary = Path(directory)
        bundle = temporary / 'source.bundle'
        run('git', '-C', source, 'bundle', 'create', bundle, 'HEAD')
        exported = temporary / 'export'
        exported.mkdir(mode=0o777)
        exported.chmod(0o777)
        run('docker', 'run', '--rm', '--platform', 'linux/amd64',
            '--mount', f'type=bind,source={bundle},target=/input/source.bundle,readonly',
            '--mount', f'type=bind,source={tools},target=/tools,readonly',
            '--mount', f'type=bind,source={exported},target=/export',
            IMAGE, 'bash', '-euc', '''
umask 077
python3 -m unittest discover -s /tools -p 'test_admin.py' -v
python3 /tools/pi-web-admin.py build --repo /input/source.bundle --commit "$1" --output /tmp/artifacts
releases=(/tmp/artifacts/*)
[ "${#releases[@]}" -eq 1 ]
tar -czf /export/pi-web-linux-x64.tar.gz -C "${releases[0]}" .
cp "${releases[0]}/release.json" /export/release.json
''', 'build-release', commit)
        stage_archive(exported / 'pi-web-linux-x64.tar.gz', exported / 'release.json', destination, commit)
    print(f'[release] Staged in {destination}; NOT committed, pushed or deployed.', flush=True)
    print('[release] Review release.json, then git add the archive, release.json and SHA256SUMS; commit and push.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        raise SystemExit(f'[release] ERROR: {error}')
