import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { makeCondition, conditionLogic, packageCondition, relationLabel, uniqueTags, levelOptions, dataDayRange, rangesOverlap, splitAlarmContentBlocks } = await jiti.import('./logic.ts');
const { isRowSensitive, maskCjqkText, maskPersonName, maskIdNo, maskPhone } = await jiti.import('./privacyMask.ts');
const { collectDeptScopeIds, buildDeptTreeOptions } = await jiti.import('./deptTree.ts');
const { departmentFilter } = await jiti.import('./scope.ts');
const tag = path => ({ id: path, name: path.split('/').pop(), tagPath: path });

test('group conditions keep AND within each group and configurable AND/OR between groups', () => {
  const groups = [[tag('A/1'), tag('A/2')], [tag('B/3')], []];
  const condition = makeCondition('groups', 'any', groups);
  assert.deepEqual(condition, { unit: 'groups', match: 'any', groups: [['A/1', 'A/2'], ['B/3']] });
  assert.deepEqual(JSON.parse(conditionLogic(condition)), { join: 'or', groups: [['A/1', 'A/2'], ['B/3']] });
  assert.equal(JSON.parse(conditionLogic(makeCondition('groups', 'all', groups))).join, 'and');
  assert.equal(conditionLogic(makeCondition('single', 'all', groups)), 'and');
  assert.equal(conditionLogic(makeCondition('single', 'any', groups)), 'or');
});

test('single-tag packages normalize to any; duplicates are unioned without dropping group membership', () => {
  const a = tag('A/1');
  assert.deepEqual(uniqueTags([[a], [a, tag('B/2')]]).map(t => t.tagPath), ['A/1', 'B/2']);
  assert.equal(makeCondition('groups', 'all', [[a], [a]]).unit, 'single');
  assert.equal(makeCondition('single', 'all', [[a]]).match, 'any');
});

test('package authoritative condition wins over legacy logic, and legacy JSON round-trips', () => {
  const tags = [tag('A'), tag('B'), tag('C')];
  const legacy = { id: '1', name: 'test', remark: '', createdAt: '', tags, logic: JSON.stringify({ join: 'or', groups: [['A', 'B'], ['C']] }) };
  assert.deepEqual(packageCondition(legacy), { unit: 'groups', match: 'any', groups: [[tags[0], tags[1]], [tags[2]]] });
  assert.equal(relationLabel(legacy), '多组·满足任意组');
  assert.deepEqual(packageCondition({ ...legacy, condition: { unit: 'single', match: 'all', groups: [['A', 'B', 'C']] } }), { unit: 'single', match: 'all', groups: [tags] });
  assert.equal(packageCondition({ ...legacy, logic: '{bad json' }).match, 'all');
});

test('cascading tag levels retain complete paths and remove unrelated children', () => {
  const catalog = [{ level1: 'A', level2: 'one', level3: 'x' }, { level1: 'B', level2: 'one', level3: 'y' }, { level1: 'A', level2: 'one', level3: 'x' }];
  assert.deepEqual(levelOptions(catalog, 2, 'A'), [{ label: 'one', value: 'A/one' }]);
  assert.deepEqual(levelOptions(catalog, 3, 'B/one'), [{ label: 'y', value: 'B/one/y' }]);
});

test('tagged day defaults and half-open time overlap', () => {
  assert.deepEqual(dataDayRange('2026-08-01 13:00:00', '2026-08-27 22:30:00', true), ['2026-08-27 00:00:00', '2026-08-28 00:00:00']);
  assert.deepEqual(dataDayRange('2026-08-01 13:00:00', '2026-08-27 22:30:00'), ['2026-08-01 00:00:00', '2026-08-28 00:00:00']);
  assert.equal(dataDayRange(null, 'invalid'), null);
  assert.equal(rangesOverlap('2026-08-01', '2026-08-02', '2026-08-02', '2026-08-03'), false);
  assert.equal(rangesOverlap('2026-08-01', '2026-08-03', '2026-08-02', '2026-08-04'), true);
});

test('verification content target moves to third position without losing any blocks', () => {
  const result = splitAlarmContentBlocks('【警情内容及处置情况】target【A】a【B】b【C】c');
  assert.equal(result.highlightIndex, 2);
  assert.deepEqual(result.blocks, ['【A】a', '【B】b', '【警情内容及处置情况】target', '【C】c']);
  assert.deepEqual(splitAlarmContentBlocks('plain'), { blocks: ['plain'], highlightIndex: -1 });
});

test('privacy sensitivity and Safari-compatible masking preserve original boundaries', () => {
  assert.equal(isRowSensitive({ sensitive: true }), true);
  assert.equal(isRowSensitive({ bjlxdm: '10180.0' }), true);
  assert.equal(isRowSensitive({ bjlxdm: '10000' }), false);
  assert.equal(maskPersonName('张三'), '张*');
  assert.equal(maskIdNo('330100199001011234'), '3301**********1234');
  assert.equal(maskPhone('13800138000'), '138****8000');
  const text = maskCjqkText('报警人：张三、男、1990年01月 电话13800138000，13800138001；证件330100199001011234 东路123号4楼', { personNames: ['张三'] });
  assert.ok(!text.includes('张三'));
  assert.ok(!text.includes('13800138000'));
  assert.ok(!text.includes('13800138001'));
  assert.ok(!text.includes('330100199001011234'));
  assert.ok(!text.includes('东路123'));
  assert.ok(text.includes('**********1234')); // Original rule deliberately retains the ID suffix.
  assert.equal(maskCjqkText('9138001380007'), '9138001380007');
});

test('department descendants scope the picker, root nodes never send an expensive name-only query', () => {
  const depts = [{ deptId: 1, deptCode: 'city', deptName: '市局', parentId: 0, orderNum: 0 }, { deptId: 2, deptCode: 'station', deptName: '派出所', parentId: 1, orderNum: 1 }, { deptId: 3, deptCode: 'child', deptName: '社区', parentId: 2, orderNum: 2 }];
  assert.deepEqual([...collectDeptScopeIds(depts, 2)], [2, 3]);
  assert.equal(buildDeptTreeOptions(depts)[0].children[0].children[0].key, '3');
  const scope = { user: { is_root_department: true, root_department_code: 'city' }, depts, defaultKey: '' };
  assert.deepEqual(departmentFilter(scope, '1', true), {});
  assert.deepEqual(departmentFilter(scope, '2'), { fkdwdm: 'station' });
  assert.deepEqual(departmentFilter({ user: { unit_code: 'station', department_name: '派出所', is_root_department: false }, depts: [], defaultKey: '' }, '', true), { fkdwdm: 'station', fkdwmc: '派出所' });
});
