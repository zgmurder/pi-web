"""Linux-only tests; fake systemctl/HTTP, never create real accounts or services."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('admin', Path(__file__).with_name('pi-web-admin.py'))
admin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admin)
R1 = 'a' * 12 + '-20261020000000-11111111'
R2 = 'b' * 12 + '-20261020000000-22222222'


class AdminTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.patches = patch.multiple(admin, ROOT=root / 'root', CONFIG=root / 'config')
        self.patches.start()
        self.addCleanup(self.patches.stop)
        admin.ROOT.mkdir()
        admin.CONFIG.mkdir()
        self.instance = admin.ROOT / 'instances/alice'
        self.instance.mkdir(parents=True)
        for release in (R1, R2):
            (self.instance / 'releases' / release).mkdir(parents=True)
        admin.write_json(admin.CONFIG / 'alice.json', {'name': 'alice', 'port': 30151})
        self.commands = []

    def test_build_only_disables_offline_mode_for_unit_tests(self):
        args = admin.parser().parse_args(['build', '--repo', 'test.bundle', '--commit', 'a' * 40,
                                          '--output', str(Path(self.tmp.name) / 'artifacts')])
        calls = []

        def fake_run(*command, **kwargs):
            if 'env' in kwargs:
                calls.append((command, kwargs['env']['PI_OFFLINE']))
            if command == ('npm', 'run', 'build'):
                raise RuntimeError('stop before artifact assembly')

        with patch.object(admin.os, 'geteuid', return_value=1000), \
             patch.object(admin, 'run', side_effect=fake_run), \
             patch.object(admin, 'output', return_value='a' * 40), \
             self.assertRaisesRegex(RuntimeError, 'stop before artifact assembly'):
            admin.build(args)
        self.assertEqual([offline for command, offline in calls if command == ('npm', 'test')], ['0'])
        self.assertTrue(all(offline == '1' for command, offline in calls if command != ('npm', 'test')))

    def test_next_cache_is_lockfile_scoped_and_failed_builds_do_not_replace_it(self):
        root = Path(self.tmp.name)
        work, cache = root / 'work', root / 'cache'
        work.mkdir()
        lockfile = work / 'package-lock.json'
        lockfile.write_text('first')
        local = work / '.next/cache'
        with admin.next_build_cache(work, cache):
            local.mkdir(parents=True)
            (local / 'data').write_text('good')
        admin.shutil.rmtree(work / '.next')
        with self.assertRaises(RuntimeError):
            with admin.next_build_cache(work, cache):
                self.assertEqual((local / 'data').read_text(), 'good')
                (local / 'data').write_text('failed')
                raise RuntimeError('build failed')
        admin.shutil.rmtree(work / '.next')
        with admin.next_build_cache(work, cache):
            self.assertEqual((local / 'data').read_text(), 'good')
        admin.shutil.rmtree(work / '.next')
        lockfile.write_text('different dependencies')
        with admin.next_build_cache(work, cache):
            self.assertFalse(local.exists())

    def test_names_and_releases_refuse_path_injection(self):
        for name in ('../bob', 'Alice', '-root', 'a b', 'a\nb', 'x' * 25):
            with self.assertRaises(ValueError):
                admin.valid_name(name)
        self.assertEqual(admin.valid_name('alice-2'), 'alice-2')
        for release in ('../../etc', R1 + '/x', R1.upper()):
            with self.assertRaises(ValueError):
                admin.release_path(release)

    def test_maintenance_confirmation_is_required(self):
        with self.assertRaises(SystemExit), patch('sys.stderr'):
            admin.parser().parse_args(['deploy', '--all', '--release', R1])
        args = admin.parser().parse_args(['deploy', '--all', '--release', R1, '--maintenance-confirmed'])
        self.assertTrue(args.maintenance_confirmed)

    def test_release_rejects_external_absolute_and_broken_symlinks(self):
        source = Path(self.tmp.name) / 'source'
        source.mkdir()
        (source / 'file').write_text('ok')
        link = source / 'link'
        link.symlink_to('file')
        admin.validate_tree(source)
        for target in ('../outside', str(source / 'file'), 'missing'):
            link.unlink()
            if target == '../outside':
                (source.parent / 'outside').write_text('private')
            link.symlink_to(target)
            with self.assertRaises((ValueError, FileNotFoundError)):
                admin.validate_tree(source)

    def test_release_rejects_env_and_special_files(self):
        source = Path(self.tmp.name) / 'source'
        source.mkdir()
        env = source / '.env.local'
        env.write_text('SECRET=not-real')
        with self.assertRaises(ValueError):
            admin.validate_tree(source)
        env.unlink()
        os.mkfifo(source / 'fifo')
        with self.assertRaises(ValueError):
            admin.validate_tree(source)

    def test_current_link_cannot_escape_instance(self):
        (self.instance / 'current').symlink_to(admin.ROOT)
        with self.assertRaises(ValueError):
            admin.link_release(self.instance, 'current')

    def mock_run(self, *args, **kwargs):
        self.commands.append(args)

    def activation(self, health, active=True):
        return (
            patch.object(admin, 'stage_instance', return_value=self.instance / 'releases' / R2),
            patch.object(admin, 'run', side_effect=self.mock_run),
            patch.object(admin, 'healthy', side_effect=health),
            patch.object(admin.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0 if active else 3)),
        )

    def test_success_remembers_previous_and_preserves_private_data(self):
        admin.set_link(self.instance / 'current', self.instance / 'releases' / R1)
        private = Path(self.tmp.name) / 'user-data'
        private.write_text('session-and-credentials')
        a, b, c, d = self.activation([None])
        with a, b, c, d:
            admin.activate('alice', R2)
        self.assertEqual(admin.link_release(self.instance, 'current'), R2)
        self.assertEqual(admin.link_release(self.instance, 'previous'), R1)
        self.assertEqual(private.read_text(), 'session-and-credentials')
        self.assertEqual(self.commands, [('systemctl', 'stop', 'pi-web@alice.service'),
                                         ('systemctl', 'start', 'pi-web@alice.service')])

    def test_failed_health_rolls_back_and_propagates_error(self):
        admin.set_link(self.instance / 'current', self.instance / 'releases' / R1)
        a, b, c, d = self.activation([RuntimeError('candidate failed'), None])
        with a, b, c, d, self.assertRaisesRegex(RuntimeError, 'candidate failed'):
            admin.activate('alice', R2)
        self.assertEqual(admin.link_release(self.instance, 'current'), R1)
        self.assertFalse((self.instance / 'previous').exists())
        self.assertEqual([command[1] for command in self.commands], ['stop', 'start', 'stop', 'start'])

    def test_first_install_failure_leaves_no_current_link(self):
        a, b, c, d = self.activation([RuntimeError('candidate failed')], active=False)
        with a, b, c, d, self.assertRaises(RuntimeError):
            admin.activate('alice', R2)
        self.assertFalse((self.instance / 'current').is_symlink())

    def test_stopped_old_instance_stays_stopped_after_failure(self):
        admin.set_link(self.instance / 'current', self.instance / 'releases' / R1)
        a, b, c, d = self.activation([RuntimeError('candidate failed')], active=False)
        with a, b, c, d, self.assertRaises(RuntimeError):
            admin.activate('alice', R2)
        self.assertEqual(admin.link_release(self.instance, 'current'), R1)
        self.assertEqual([command[1] for command in self.commands], ['stop', 'start', 'stop'])

    def test_same_release_checks_health_without_restart(self):
        admin.set_link(self.instance / 'current', self.instance / 'releases' / R1)
        with patch.object(admin, 'healthy') as health, patch.object(admin, 'run') as command:
            admin.activate('alice', R1)
        health.assert_called_once()
        command.assert_not_called()

    def test_health_requires_auth_denial_and_market_diagnostics(self):
        denied = admin.urllib.error.HTTPError('http://localhost', 401, 'Unauthorized', {}, None)
        replies = [
            {'enabled': True, 'authenticated': True},
            {'enabled': True, 'authenticated': False}, denied,
            {'runningSessionIds': []}, {'diagnostics': []},
        ]
        with patch.object(admin, 'api', side_effect=replies) as api:
            admin.healthy({'name': 'alice', 'port': 30151})
        self.assertEqual(api.call_count, 5)
        with patch.object(admin, 'api', return_value={'enabled': False, 'authenticated': True}), \
             patch.object(admin.time, 'monotonic', side_effect=[0, 0, 100]), \
             patch.object(admin.time, 'sleep'), self.assertRaises(RuntimeError):
            admin.healthy({'name': 'alice', 'port': 30151})

    def test_all_stops_after_first_failed_instance(self):
        admin.write_json(admin.CONFIG / 'bob.json', {'name': 'bob', 'port': 30152})
        with patch('sys.argv', ['admin', 'deploy', '--all', '--release', R2, '--maintenance-confirmed']), \
             patch.object(admin, 'admin_lock', admin.contextlib.nullcontext), \
             patch.object(admin, 'metadata'), \
             patch.object(admin.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)), \
             patch.object(admin, 'activate', side_effect=RuntimeError('failed')) as activate, \
             self.assertRaises(RuntimeError):
            admin.main()
        activate.assert_called_once_with('alice', R2)

    def test_all_skips_stopped_instances(self):
        with patch('sys.argv', ['admin', 'deploy', '--all', '--release', R2, '--maintenance-confirmed']), \
             patch.object(admin, 'admin_lock', admin.contextlib.nullcontext), \
             patch.object(admin, 'metadata'), \
             patch.object(admin.subprocess, 'run', return_value=subprocess.CompletedProcess([], 3)), \
             patch.object(admin, 'activate') as activate:
            admin.main()
        activate.assert_not_called()

    def test_admin_directories_refuse_symlinks(self):
        (admin.ROOT / 'releases').symlink_to(admin.CONFIG)
        with patch.object(admin.os, 'geteuid', return_value=0), self.assertRaisesRegex(ValueError, 'Unsafe'):
            with admin.admin_lock():
                pass

    def test_service_fails_closed_and_keeps_users_separate(self):
        service = Path(__file__).with_name('pi-web@.service').read_text()
        for setting in ('User=pi-%i', 'Group=pi-%i', 'ProtectHome=tmpfs',
                        'BindPaths=/home/pi-%i', 'NoNewPrivileges=true', 'UMask=0077',
                        'KillMode=control-group', 'ProtectSystem=strict'):
            self.assertIn(setting, service)
        self.assertIn('ExecStartPre=', service)
        self.assertIn('rotatePreviewSecrets', service)
        self.assertIn('process.exit(1)', service)
        self.assertIn('bin/pi-web.js --no-open', service)

    def test_market_health_error_is_not_accepted(self):
        denied = admin.urllib.error.HTTPError('http://localhost', 401, 'Unauthorized', {}, None)
        with patch.object(admin, 'api', side_effect=[
            {'enabled': True, 'authenticated': True}, {'authenticated': False}, denied,
            {'runningSessionIds': []}, {'diagnostics': ['invalid plugin']},
        ]), patch.object(admin.time, 'monotonic', side_effect=[0, 0, 100]), \
             patch.object(admin.time, 'sleep'), self.assertRaises(RuntimeError):
            admin.healthy({'name': 'alice', 'port': 30151})

    def test_stage_keeps_app_root_owned_and_next_user_private(self):
        source = admin.ROOT / 'releases' / R1
        (source / '.next/server').mkdir(parents=True)
        (source / '.next/server/file.js').write_text('code')
        (source / 'package.json').write_text('{}')
        target = self.instance / 'releases' / R1
        target.rmdir()
        account = type('Account', (), {'pw_uid': 12345, 'pw_gid': 12345})()
        with patch.object(admin, 'metadata'), patch.object(admin.pwd, 'getpwnam', return_value=account), \
             patch.object(admin.os, 'chown') as chown:
            admin.stage_instance('alice', R1)
        self.assertEqual((target / '.next').stat().st_mode & 0o777, 0o700)
        self.assertEqual((target / '.next/server/file.js').stat().st_mode & 0o777, 0o600)
        self.assertTrue(all('/.next' in str(call.args[0]) for call in chown.call_args_list))
        self.assertEqual((target / 'package.json').read_text(), '{}')

    def test_permissions_normalization_does_not_follow_symlinks(self):
        tree = Path(self.tmp.name) / 'tree'
        tree.mkdir()
        target = tree / 'file'
        target.write_text('data')
        target.chmod(0o600)
        (tree / 'link').symlink_to('file')
        executable = tree / 'script'
        executable.write_text('#!/bin/sh\n')
        executable.chmod(0o700)
        admin.normalize_permissions(tree)
        self.assertEqual(target.stat().st_mode & 0o777, 0o644)
        self.assertEqual(executable.stat().st_mode & 0o777, 0o755)
        self.assertTrue((tree / 'link').is_symlink())


if __name__ == '__main__':
    unittest.main()
