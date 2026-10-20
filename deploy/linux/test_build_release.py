"""Cross-platform checks; never start Docker or contact Gitblit."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('build-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def test_checkout_must_be_separate_clean_and_point_to_release_remote(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source, dest = root / 'source', root / 'releases'
            with self.assertRaises(ValueError):
                release.check_repository(source, source / 'release')
            for remote, status in [('wrong', ''), (release.RELEASE_REMOTE, ' M release.json')]:
                with patch.object(release, 'git_output', side_effect=[str(dest), remote, status]):
                    with self.assertRaises(ValueError):
                        release.check_repository(source, dest)
            with patch.object(release, 'git_output', side_effect=[str(dest), release.RELEASE_REMOTE, '']):
                release.check_repository(source, dest)

    def test_failed_metadata_leaves_old_archive_and_success_stages_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dest = root / 'repo'
            dest.mkdir()
            old = dest / 'pi-web-linux-x64.tar.gz'
            old.write_bytes(b'old')
            archive, manifest = root / 'new.tar.gz', root / 'release.json'
            archive.write_bytes(b'new')
            data = dict(commit='a' * 40, platform='Windows', arch='x86_64', node='v22.19.0')
            manifest.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                release.stage_archive(archive, manifest, dest, 'a' * 40)
            self.assertEqual(old.read_bytes(), b'old')
            data['platform'] = 'Linux'
            manifest.write_text(json.dumps(data))
            release.stage_archive(archive, manifest, dest, 'a' * 40)
            self.assertEqual(old.read_bytes(), b'new')
            self.assertEqual((dest / 'SHA256SUMS').read_text(),
                             hashlib.sha256(b'new').hexdigest() + '  pi-web-linux-x64.tar.gz\n')
            self.assertEqual(json.loads((dest / 'release.json').read_text()), data)


if __name__ == '__main__':
    unittest.main()
