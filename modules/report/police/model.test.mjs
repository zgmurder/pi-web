import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const model = await jiti.import('./model.ts');
const privacy = await jiti.import('./privacyMask.ts');
const { defaultDistrict, newQueryForm, queryPayload, queryQuick, statsQuick, classificationOptions, incidentOptions, dependentOptions, comparisonRate, newStatsForm, statsPayload } = model;
const tree = [{code:'A',name:'类别A',level:'category',children:[{code:'A1',parentCode:'A',name:'类型A1',level:'type',children:[{code:'A11',name:'细类A11',level:'subtype',children:[]}]}]},{code:'B',name:'类别B',level:'category',children:[{code:'B1',parentCode:'B',name:'类型B1',level:'type',children:[{code:'B11',name:'细类B11',level:'subtype',children:[]}]}]}];

test('department defaults use the original 110 district code system', () => {
  assert.equal(defaultDistrict('330783000000'),'330783');
  assert.equal(defaultDistrict('330782000000'),'330782');
  assert.equal(defaultDistrict('unknown'),'');
});

test('query payload retains hidden filters but gates feedback times by active tab', () => {
  const form=newQueryForm('330783000000',false);
  form.alarmRange=['2026-10-01T00:00','2026-10-02T23:59:59'];
  form.feedbackRange=['2026-10-01T08:00','2026-10-01T18:00'];
  form.finalFeedbackRange=['2026-10-02T08:00','2026-10-02T18:00'];
  Object.assign(form.values,{keyword:'  词1&词2  ',feedback_keyword:'反馈',tag_category:'父标签',tag_major:'子标签',content_max_len:'100',hour_start:'23:00',hour_end:'02:00'});
  form.handle_types=['10','11'];
  const alarm=queryPayload(form,'alarm');
  assert.equal(alarm.start_time,'2026-10-01 00:00:00');
  assert.equal(alarm.feedback_start_time,undefined);
  assert.equal(alarm.final_feedback_start_time,undefined);
  assert.equal(alarm.feedback_keyword,'反馈');
  assert.equal(alarm.keyword,'词1&词2');
  assert.equal(alarm.content_max_len,100);
  assert.equal(alarm.hour_start,'23:00');
  assert.deepEqual(alarm.tag_names,['父标签','子标签']);
  assert.equal(alarm.tag_category,undefined);
  assert.deepEqual(alarm.handle_types,['10','11']);
  const feedback=queryPayload(form,'feedback');
  assert.equal(feedback.feedback_start_time,'2026-10-01 08:00:00');
  assert.equal(feedback.final_feedback_end_time,'2026-10-02 18:00:00');
  form.values.district_code='';
  assert.equal(queryPayload(form,'tag').district_include_sub,undefined);
});

test('query quick ranges preserve original calendar boundaries including first-day week/month semantics', () => {
  const now=new Date(2026,9,8,12,34,56);
  assert.deepEqual(queryQuick('lastWeek',now),['2026-09-28T00:00:00','2026-10-04T23:59:59']);
  assert.deepEqual(queryQuick('lastMonth',now),['2026-09-01T00:00:00','2026-09-30T23:59:59']);
  assert.deepEqual(queryQuick('week',now),['2026-10-05T00:00:00','2026-10-05T23:59:59']);
  assert.deepEqual(queryQuick('month',now),['2026-10-01T00:00:00','2026-10-01T23:59:59']);
  assert.deepEqual(statsQuick('yesterday',now),['2026-10-07T00:00:00','2026-10-08T00:00:00']);
  assert.deepEqual(statsQuick('week',now),['2026-10-02T00:00:00','2026-10-08T12:34:56']);
});

test('query classifications flatten the full dictionary while statistics cascade selected parents', () => {
  assert.deepEqual(classificationOptions(tree).map(level=>level.map(o=>o.value)),[['A','B'],['A1','B1'],['A11','B11']]);
  assert.deepEqual(incidentOptions(tree,['B'],[])[1].map(o=>o.value),['B1']);
  assert.deepEqual(incidentOptions(tree,[],['A1'])[2].map(o=>o.value),['A11']);
  assert.deepEqual(dependentOptions(tree,'B','B1')[2].map(o=>o.value),['B11']);
});

test('empty stats filters normalize disabled inclusion checks without mutating the draft', () => {
  const form={...newStatsForm(),category_codes:[],include_category:false,alarm_method:'1',include_alarm_method:false};
  const payload=statsPayload(form);
  assert.equal(payload.include_category,true);
  assert.equal(payload.include_alarm_method,false);
  assert.equal(form.include_category,false);
  assert.ok(!payload.start_time.includes('T'));
});

test('comparison rates distinguish zero/missing baselines from zero change', () => {
  assert.equal(comparisonRate({total:15,yoy:{total:10}},'yoy','total'),50);
  assert.equal(comparisonRate({total:5,mom:{total:10}},'mom','total'),-50);
  assert.equal(comparisonRate({total:0,yoy:{total:0}},'yoy','total'),null);
  assert.equal(comparisonRate({total:5},'yoy','total'),null);
  assert.equal(comparisonRate({total:10,yoy:{total:10}},'yoy','total'),0);
});

test('sensitive text masking covers names, IDs, consecutive phone numbers and street numbers without lookbehind', () => {
  assert.equal(privacy.maskCjqkText('姓名：张三，电话13812345678、13912345678，证件330783199001011234，人民路123号4楼'),'姓名张*，电话138****5678、139****5678，证件3307**********1234，人民路**号**楼');
  assert.equal(privacy.maskCjqkText('人民路123，村456'),'人民路**，村**');
  assert.equal(privacy.maskCjqkText('9138123456789'),'9138123456789');
  assert.equal(privacy.isSensitiveAlarm('10180.0'),true);
});
