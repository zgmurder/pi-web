import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
const { unpackSkillHubZip, readSkillHubMarket, installSkillHubSkill, skillHubUrl } = await createJiti(import.meta.url).import('./skill-hub-market.ts');

// Small stored ZIP fixtures, including names that safe ZIP writers would refuse.
function zip(files) {
  const local = [], central = []; let offset = 0;
  for (const [name, text, mode = 0o100644] of files) {
    const filename = Buffer.from(name), data = Buffer.from(text), crc = crc32(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(0x314, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(filename.length, 28);
    entry.writeUInt32LE((mode << 16) >>> 0, 38); entry.writeUInt32LE(offset, 42);
    local.push(header, filename, data); central.push(entry, filename); offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const manifest = '---\nname: actual-name\ndescription: Test skill\n---\nInstructions';

test('managed V2 catalogue/install uses only request capability and never falls back to shared token', async () => {
  const bytes = zip([['SKILL.md', manifest]]);
  const item = { skillCode: 'hub-id', skillName: 'Title', releaseId: 'r1', installable: true,
    packageSize: bytes.length, packageSha256: createHash('sha256').update(bytes).digest('hex') };
  const keys = ['PI_WEB_SKILL_HUB_MANAGED', 'PI_WEB_SKILL_HUB_BRIDGE_URL', 'PI_WEB_SKILL_HUB_TOKEN'];
  const previous = keys.map(k => process.env[k]); let mode = 'ok'; const calls = [];
  const server = createServer((req, res) => {
    calls.push(req.url); assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers['x-workspace-skill-capability'], 'a'.repeat(64));
    if (mode === 'revoked') { res.writeHead(401); res.end('secret'); return; }
    if (mode === 'redirect') { res.writeHead(302, { Location: 'http://example.invalid' }); res.end(); return; }
    if (req.url.endsWith('/package')) { res.end(bytes); return; }
    res.end(JSON.stringify(req.url.includes('?') ? { records: [item, { skillCode: 'hidden', installable: false }], total: 2 } : item));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = await mkdtemp(path.join(tmpdir(), 'hub-managed-test-'));
  process.env.PI_WEB_SKILL_HUB_MANAGED = '1';
  process.env.PI_WEB_SKILL_HUB_BRIDGE_URL = `http://127.0.0.1:${server.address().port}/skill-market/`;
  process.env.PI_WEB_SKILL_HUB_TOKEN = 'must-not-be-used';
  const req = new Request('http://localhost/api/market', { headers: { 'x-workspace-skill-capability': 'a'.repeat(64), 'x-workspace-skill-url': 'http://example.invalid' } });
  try {
    await assert.rejects(() => readSkillHubMarket(), /从平台重新打开/); assert.equal(calls.length, 0);
    assert.equal((await readSkillHubMarket(req)).length, 1);
    assert.equal(await installSkillHubSkill('hub-id', root, req), 'actual-name');
    assert.equal(await readFile(path.join(root, 'actual-name/SKILL.md'), 'utf8'), manifest);
    mode = 'revoked'; await assert.rejects(() => readSkillHubMarket(req), /401.*重新打开/);
    mode = 'redirect'; await assert.rejects(() => readSkillHubMarket(req), /failed/);
    delete process.env.PI_WEB_SKILL_HUB_BRIDGE_URL;
    await assert.rejects(() => readSkillHubMarket(req), /桥接配置/);
    delete process.env.PI_WEB_SKILL_HUB_MANAGED;
    await assert.rejects(() => readSkillHubMarket(req), /桥接配置/);
    assert.ok(calls.every(url => url.startsWith('/skill-market/desktop/skills')));
  } finally {
    keys.forEach((k, i) => previous[i] === undefined ? delete process.env[k] : process.env[k] = previous[i]);
    await rm(root, { recursive: true, force: true }); await new Promise(resolve => server.close(resolve));
  }
});
test('cross-repo authenticated proxy → Pi adapter → bridge → platform → safe installer', { skip: !process.env.SKILL_HUB_GATEWAY_SOURCE }, async () => {
  const { WorkspaceGateway, digest, ownerOf } = await import(pathToFileURL(path.resolve(process.env.SKILL_HUB_GATEWAY_SOURCE)).href);
  const bytes = zip([['SKILL.md', manifest]]);
  const item = { skillCode: 'catalogue', skillName: 'Title', releaseId: 'r1', installable: true,
    packageSize: bytes.length, packageSha256: createHash('sha256').update(bytes).digest('hex') };
  const serve = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  const root = await mkdtemp(path.join(tmpdir(), 'hub-e2e-test-'));
  let revoked = false; const platformCalls = [];
  const platform = createServer((req, res) => {
    assert.equal(req.headers['x-workspace-key'], 'key'); assert.equal(req.headers['x-access-token'], 'platform-token');
    platformCalls.push(req.url);
    if (req.url.endsWith('/package')) { res.end(bytes); return; }
    res.end(JSON.stringify(req.url.includes('?') ? { records: [item], total: 1 } : item));
  });
  const platformPort = await serve(platform);
  const g = new WorkspaceGateway({ publicUrl: 'https://pi.example.test', platformOrigin: 'https://hub.example.test', internalKey: 'key',
    identityUrl: `http://127.0.0.1:${platformPort}/pi-workspace/internal/identity` }, {});
  g.identity = async () => { if (revoked) throw new Error('revoked'); return { userId: 'A' }; };
  const session = { owner: ownerOf('A'), token: 'platform-token', expiresAt: Date.now() + 60000, connections: new Set() };
  g.sessions.set(digest(session.token), session); g.records.set('r', { id: 'r', userId: 'A', state: 'READY' });
  const cookie = 'b'.repeat(64); g.cookies.set(digest(cookie), digest(session.token));
  const bridge = createServer((req, res) => void g.internal(req, res)); const bridgePort = await serve(bridge);
  const keys = ['PI_WEB_SKILL_HUB_MANAGED', 'PI_WEB_SKILL_HUB_BRIDGE_URL', 'PI_WEB_SKILL_HUB_TOKEN']; const previous = keys.map(k => process.env[k]);
  process.env.PI_WEB_SKILL_HUB_MANAGED = '1'; process.env.PI_WEB_SKILL_HUB_BRIDGE_URL = `http://127.0.0.1:${bridgePort}/skill-market/`; process.env.PI_WEB_SKILL_HUB_TOKEN = 'never-used';
  const pi = createServer(async (req, res) => {
    try {
      const context = new Request('http://localhost' + req.url, { headers: req.headers });
      const value = req.method === 'GET' ? await readSkillHubMarket(context) : await installSkillHubSkill('catalogue', root, context);
      res.end(JSON.stringify(value));
    } catch { res.writeHead(500); res.end('install failed'); }
  });
  const piPort = await serve(pi); g.runtime.target = async () => new URL(`http://127.0.0.1:${piPort}`);
  const gateway = createServer((req, res) => void g.public(req, res)); const gatewayPort = await serve(gateway);
  const call = (resource, body) => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: gatewayPort, path: resource, method: body ? 'POST' : 'GET', headers: {
      host: `${session.owner}.pi.example.test`, cookie: `pi_workspace=${cookie}`, 'content-type': 'application/json', 'x-workspace-skill-capability': 'spoof',
    } }, res => { let text = ''; res.on('data', c => text += c); res.on('end', () => resolve({ status: res.statusCode, text })); });
    req.on('error', reject); req.end(body);
  });
  try {
    const list = await call('/api/market?kind=skill'); assert.equal(list.status, 200); assert.equal(JSON.parse(list.text)[0].id, 'skillhub:catalogue');
    const install = await call('/api/skills/install', JSON.stringify({ marketId: 'skillhub:catalogue', scope: 'global' }));
    assert.equal(install.status, 200); assert.equal(JSON.parse(install.text), 'actual-name');
    assert.equal(await readFile(path.join(root, 'actual-name/SKILL.md'), 'utf8'), manifest);
    assert.equal((await call('/api/skills/install', JSON.stringify({ marketId: 'skillhub:other', scope: 'global' }))).status, 500);
    revoked = true; assert.equal((await call('/api/market?kind=skill')).status, 401);
    assert.equal(platformCalls.length, 3);
  } finally {
    keys.forEach((k, i) => previous[i] === undefined ? delete process.env[k] : process.env[k] = previous[i]);
    for (const server of [gateway, pi, bridge, platform]) await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('ZIP accepts flat/wrapped skills and rejects traversal, aliases, links and ambiguous roots', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hub-zip-test-'));
  try {
    for (const prefix of ['', 'wrapper/']) {
      const target = path.join(root, prefix ? 'wrapped' : 'flat');
      const source = await unpackSkillHubZip(zip([[`${prefix}SKILL.md`, manifest], [`${prefix}scripts/run.sh`, 'echo hi', 0o100755]]), target);
      assert.equal(await readFile(path.join(source, 'SKILL.md'), 'utf8'), manifest);
    }
    for (const files of [
      [['../escape', 'x']], [['CON', 'x']], [['a\\b', 'x']], [['SKILL.md', manifest], ['skill.md', 'x']],
      [['SKILL.md', manifest], ['link', 'outside', 0o120777]],
      [['a/SKILL.md', manifest], ['b/SKILL.md', manifest]], [['a/SKILL.md', manifest], ['outside', 'x']],
    ]) await assert.rejects(() => unpackSkillHubZip(zip(files), path.join(root, 'bad')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('authenticated pagination, release checksum, install name, collision and failures', async () => {
  const bytes = zip([['wrapper/SKILL.md', manifest], ['wrapper/scripts/run.sh', 'echo hi']]);
  const item = { skillCode: 'hub-id', skillName: '展示名称', skillSummary: 'Description', releaseId: 'r1', releaseVersion: '1.0' };
  let mode = 'ok'; const calls = [];
  const server = createServer((req, res) => {
    calls.push(req.url); assert.equal(req.headers.authorization, 'Bearer test-token');
    if (mode === '401') { res.writeHead(401); res.end('private error'); return; }
    if (mode === 'redirect') { res.writeHead(302, { Location: '/elsewhere' }); res.end(); return; }
    if (req.url.endsWith('/package')) { res.end(bytes); return; }
    if (req.url.includes('?')) {
      const second = req.url.includes('pageNo=2');
      res.end(JSON.stringify({ records: [second ? { ...item, skillCode: 'second-id' } : item], total: 2 })); return;
    }
    res.end(JSON.stringify({ ...item, packageSize: bytes.length, packageSha256: mode === 'hash' ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex') }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = [process.env.PI_WEB_SKILL_HUB_URL, process.env.PI_WEB_SKILL_HUB_TOKEN];
  const root = await mkdtemp(path.join(tmpdir(), 'hub-install-test-'));
  process.env.PI_WEB_SKILL_HUB_URL = `http://127.0.0.1:${server.address().port}/skill-hub`;
  process.env.PI_WEB_SKILL_HUB_TOKEN = 'test-token';
  try {
    const skills = await readSkillHubMarket(); assert.equal(skills.length, 2); assert.equal(skills[0].displayName, '展示名称');
    assert.ok(calls.some(url => url.startsWith('/skill-hub/desktop/skills?pageNo=2')));
    assert.equal(await installSkillHubSkill('hub-id', root), 'actual-name');
    assert.equal(await readFile(path.join(root, 'actual-name', 'SKILL.md'), 'utf8'), manifest);
    await assert.rejects(() => installSkillHubSkill('hub-id', root), /already exists/);
    mode = 'hash'; await assert.rejects(() => installSkillHubSkill('hub-id', root), /checksum/);
    mode = '401'; await assert.rejects(() => readSkillHubMarket(), /401.*expired/);
    mode = 'redirect'; await assert.rejects(() => readSkillHubMarket(), /failed/);
    delete process.env.PI_WEB_SKILL_HUB_TOKEN; await assert.rejects(() => readSkillHubMarket(), /从平台打开.*PI_WEB_SKILL_HUB_TOKEN/);
    await assert.rejects(() => installSkillHubSkill('../outside', root), /Invalid/);
    process.env.PI_WEB_SKILL_HUB_URL = 'http://user:secret@localhost'; assert.throws(skillHubUrl);
  } finally {
    ['PI_WEB_SKILL_HUB_URL', 'PI_WEB_SKILL_HUB_TOKEN'].forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]);
    await rm(root, { recursive: true, force: true }); await new Promise(resolve => server.close(resolve));
  }
});
