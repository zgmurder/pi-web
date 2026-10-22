// Read-only UI smoke test against an already running server and real Report account.
// REPORT_TEST_STORAGE_STATE must point to an untracked, private Playwright storageState.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base=process.env.REPORT_TEST_URL;
const storageState=process.env.REPORT_TEST_STORAGE_STATE;
if(!base || !storageState) throw new Error('Set REPORT_TEST_URL and REPORT_TEST_STORAGE_STATE; never commit credentials.');
const browser=process.env.REPORT_TEST_CDP ? await chromium.connectOverCDP(process.env.REPORT_TEST_CDP) : await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},storageState});
const page=await context.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto(`${base}/report/police`);
  await page.getByRole('heading',{name:'警情查询',exact:true}).waitFor();
  await page.getByRole('tab',{name:'反馈查询',exact:true}).click();
  await page.getByLabel('最终反馈时间开始',{exact:true}).waitFor();
  await page.getByRole('tab',{name:'标签查询',exact:true}).click();
  await page.getByText('以下条件至少选择一个',{exact:true}).waitFor();
  await page.getByRole('tab',{name:'接警查询',exact:true}).click();
  await page.getByText('选择显示字段',{exact:true}).click();
  await page.getByLabel('报警电话',{exact:true}).last().uncheck();
  assert.equal(await page.getByRole('columnheader',{name:'报警电话',exact:true}).count(),0);
  await page.getByText('选择显示字段',{exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log('PASS query tabs, field selection, mobile document width');
  await page.setViewportSize({width:1440,height:900});
  await page.goto(`${base}/report/police-stats`);
  await page.getByRole('heading',{name:'110 统计',exact:true}).waitFor();
  await page.getByLabel('同比',{exact:true}).check();
  await page.getByLabel('环比',{exact:true}).check();
  await page.getByLabel('县级2',{exact:true}).check();
  await page.getByRole('button',{name:'重置',exact:true}).click();
  assert.equal(await page.getByLabel('同比',{exact:true}).isChecked(),false);
  assert.equal(await page.getByLabel('县级1',{exact:true}).isChecked(),true);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('PASS statistics comparisons, level/reset, mobile document width, no page errors');
} finally {await context.close();await browser.close();}
