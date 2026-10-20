import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { c as createTar } from 'tar';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { remoteMarketUrl, readRemoteMarket, safeMarketEntry, unpackMarketArchive } = await jiti.import('./remote-market.ts');

test('validates configured origins and portable archive paths', () => {
  const before = process.env.PI_WEB_MARKET_URL;
  try {
    for (const value of ['file:///tmp', 'http://user:password@localhost', 'http://localhost/path']) {
      process.env.PI_WEB_MARKET_URL = value;
      assert.throws(() => remoteMarketUrl());
    }
    process.env.PI_WEB_MARKET_URL = 'http://127.0.0.1:30143';
    assert.equal(remoteMarketUrl().origin, 'http://127.0.0.1:30143');
    for (const value of ['../x', 'a/../../b', 'a\\b', 'C:/x', '/x', 'CON', 'a.', 'x:y', 'a//b']) assert.equal(safeMarketEntry(value), false, value);
    assert.equal(safeMarketEntry('scripts/hello.py'), true);
  } finally { if (before === undefined) delete process.env.PI_WEB_MARKET_URL; else process.env.PI_WEB_MARKET_URL = before; }
});

test('verifies hashes before unpacking and rejects duplicate archive entries', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'market-archive-test-'));
  try {
    const source = path.join(root, 'source'); await mkdir(source);
    await writeFile(path.join(source, 'SKILL.md'), '---\nname: hello\ndescription: Hello\n---\n');
    const file = path.join(root, 'test.tgz');
    await createTar({ file, cwd: source, gzip: true, portable: true }, ['SKILL.md']);
    const bytes = await readFile(file), sha = createHash('sha256').update(bytes).digest('hex');
    const target = path.join(root, 'target');
    await assert.rejects(() => unpackMarketArchive(bytes, '0'.repeat(64), target), /checksum/);
    await unpackMarketArchive(bytes, sha, target);
    assert.match(await readFile(path.join(target, 'SKILL.md'), 'utf8'), /name: hello/);
    await createTar({ file, cwd: source, gzip: true, portable: true }, ['SKILL.md', 'SKILL.md']);
    const duplicate = await readFile(file);
    await assert.rejects(() => unpackMarketArchive(duplicate, createHash('sha256').update(duplicate).digest('hex'), path.join(root, 'bad')), /unsafe/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('remote catalogue converts to existing UI contract and never silently falls back', async () => {
  let mode = 'ok';
  const server = createServer((req, res) => {
    if (mode === 'unavailable') { res.writeHead(503); res.end(); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ resources: [{ id: 'hello', kind: 'skill', name: 'Hello', description: 'A skill', readme: '---\nname: hello\ndescription: A skill\n---\n', version: '1.0.0', sha256: 'a'.repeat(64), archiveSize: mode === 'invalid' ? -1 : 100 }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const before = process.env.PI_WEB_MARKET_URL;
  process.env.PI_WEB_MARKET_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await readRemoteMarket();
    assert.equal(result.skills.length, 1);
    assert.equal(result.plugins.length, 0);
    assert.match(result.skills[0].detailUrl, /resources\/skill\/hello$/);
    mode = 'invalid'; await assert.rejects(() => readRemoteMarket(), /Invalid market/);
    mode = 'unavailable'; await assert.rejects(() => readRemoteMarket(), /503/);
  } finally {
    if (before === undefined) delete process.env.PI_WEB_MARKET_URL; else process.env.PI_WEB_MARKET_URL = before;
    await new Promise(resolve => server.close(resolve));
  }
});
