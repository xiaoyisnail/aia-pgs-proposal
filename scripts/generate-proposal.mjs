#!/usr/bin/env node
/**
 * PGS 计划书全自动生成 — 精简稳定版
 * 用法：node scripts/generate-proposal.mjs [params.json]
 */
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import {
  ensureAgencyLoggedIn,
  launchAutomationContext,
} from './login-agency.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let automationSession;

// params
const D = {
  gender:'女', insuredSexValue:'0', age:1, region:'中華人民共和國', smoking:false,
  sumAssured:300000, premiumTerm:25, extraPremium:false, sameAsInsured:true,
  productName:'愛伴航2', productCode:'OYS2',
  insuredSurname:'vip', insuredGivenName:'vip', payorSurname:'vip', payorGivenName:'vip',
  outputDir:path.join(os.homedir(),'Downloads'),
};

async function main() {
  const T0 = Date.now(); let ts = T0;
  const tick = (label) => { const e = ((Date.now()-ts)/1000).toFixed(1); ts=Date.now(); console.log(`   ⏱ ${e}s → ${label}`); };

  // load params
  let CONFIG = {...D};
  const pf = process.argv[2];
  if (pf && fs.existsSync(pf)) CONFIG = {...CONFIG, ...JSON.parse(fs.readFileSync(pf,'utf8'))};
  CONFIG.insuredSexValue = CONFIG.gender==='男'?'1':'0';
  const now = new Date();
  const bd = new Date(now.getFullYear()-CONFIG.age, now.getMonth(), now.getDate());
  const DOB = `${String(bd.getMonth()+1).padStart(2,'0')}/${String(bd.getDate()).padStart(2,'0')}/${bd.getFullYear()}`;
  const rMap = {'中華人民共和國':'大陆','香港':'香港','澳門':'澳门'};
  const FN = `${CONFIG.productName}_${CONFIG.gender}${CONFIG.age}岁_${rMap[CONFIG.region]||CONFIG.region}_USD${CONFIG.sumAssured}_${CONFIG.premiumTerm}年缴${CONFIG.smoking?'_吸烟':''}.pdf`;

  // ========= BROWSER + AGENCY LOGIN =========
  automationSession = await launchAutomationContext();
  const ctx = automationSession.context;
  tick('Chrome');
  const agency = await ensureAgencyLoggedIn(ctx);
  tick('登录');

  // ========= iPGS+ =========
  if (!agency || !/\/home/.test(agency.url())) throw new Error('未登录');
  await agency.bringToFront();
  if (!agency.url().includes('/electronic')) {
    await agency.evaluate(() => location.href = 'https://aiahk-blob01-prd.aia.com.hk/agency/zh-hk/electronic');
    await sleep(4000);
  }
  const link = agency.getByRole('link', {name:'iPGS+', exact:true}).first();
  const href = await link.getAttribute('href');
  await agency.evaluate(u => location.href = u, 'https://aiahk-blob01-prd.aia.com.hk'+href);
  await sleep(5000);
  let page = ctx.pages().find(p => /aiahk-apps.*pgs/i.test(p.url()) && !p.url().includes('/logout'));
  if (!page) throw new Error('PGS 未打开');
  console.log('✅ PGS:', page.url());
  await page.bringToFront();
  tick('iPGS+');

  // ========= FORM FILL =========
  const wait = async (m=3000) => {
    const s = Date.now();
    while(Date.now()-s<m) {
      const ok = await page.locator('#aiaLoading').evaluate(el => getComputedStyle(el).opacity==='0' || el.getAttribute('aria-hidden')==='true').catch(()=>true);
      if (ok) return;
      await sleep(150);
    }
  };

  const clickNxt = async () => {
    const btns = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null).map(b=>b.innerText?.trim()).slice(0,10));
    console.log('BTNS:', JSON.stringify(btns));
    for (const re of [/下一步/, /Next/i, /next/i]) {
      const b = page.locator('button').filter({hasText:re}).first();
      if (await b.count()) { await b.click({force:true}); console.log('👉 下一步'); return true; }
    }
    console.log('⚠️ 无下一步');
    return false;
  };

  // dismiss dialog
  const dimiss = async () => {
    await page.evaluate(() => {
      for (const d of document.querySelectorAll('.MuiDialog-root')) {
        if (getComputedStyle(d).display==='none') continue;
        for (const b of d.querySelectorAll('button')) {
          if (/^(接受|Accept|同意|Agree|OK|確認|Confirm|确定|確定)$/.test(b.innerText.trim())) b.click();
        }
      }
    });
  };

  console.log('\n--- Step 1: 受保人 ---');
  for (let i=0;i<2;i++) { await dimiss(); await sleep(500); }
  const di = page.locator('input[type="text"]').first();
  await di.click({force:true}); await sleep(100);
  await di.fill(DOB); console.log('DOB:', DOB);
  await sleep(1500); await wait();

  await page.locator(`input[name="insuredSex"][value="${CONFIG.insuredSexValue}"]`).click({force:true});
  console.log('性别:', CONFIG.gender);
  await sleep(800); await wait();

  if (CONFIG.smoking) await page.locator('input[name="insuredSmokeCode"][value="1"]').click({force:true});
  console.log('吸烟:', CONFIG.smoking?'是':'否');
  await sleep(300); await wait();

  // region select
  await page.evaluate(() => {
    const l = [...document.querySelectorAll('label')].find(l => (l.innerText.startsWith('慣常居住地')||l.innerText.startsWith('惯常居住地')));
    if (l) { const s = l.closest('.MuiFormControl-root')?.querySelector('div.MuiSelect-select'); if (s) s.click(); }
  });
  await sleep(1000);
  const opts = await page.locator('[role="option"]').allTextContents();
  if (opts.length) await page.locator('[role="option"]').filter({hasText:CONFIG.region}).first().click({force:true});
  else await page.evaluate(r => { for(const it of document.querySelectorAll('[role="listbox"] li, [role="listbox"] div')) { if(it.innerText.trim()===r){it.click();break;} } }, CONFIG.region);
  console.log('地区:', CONFIG.region);
  await sleep(800); await wait();

  // accept dialog
  await dimiss(); await sleep(500);
  await page.locator('button').filter({hasText:/接受|Accept|同意/}).first().click({force:true}).catch(()=>{});
  await sleep(800); await wait();
  tick('Step1');

  // Step 2: product
  console.log('\n--- Step 2: 产品 ---');
  await page.locator('button, [role="button"]').filter({hasText:/危疾|危疾保障|Critical/i}).first().click({force:true});
  await sleep(600);
  await page.locator('button, a, [role="button"], div[role="button"]').filter({hasText:new RegExp(CONFIG.productCode,'i')}).first().click({force:true});
  await sleep(600);
  await page.locator('button').filter({hasText:/選擇|选择|Select/}).first().click({force:true});
  await sleep(1000); await wait();
  await page.locator('button').filter({hasText:/確定|确认|Confirm|OK/}).first().click({force:true});
  await sleep(1000); await wait();
  tick('Step2');

  // Step 3: basic plan
  console.log('\n--- Step 3: 计划 ---');
  await page.evaluate(cfg => {
    const ls = [...document.querySelectorAll('label')];
    const f = t => { const l = ls.find(lb => lb.innerText.trim()===t); return l?.closest('.MuiFormControl-root')?.querySelector('input[type="radio"]'); };
    const py = f(String(cfg.premiumTerm)); if(py) py.click();
    const ep = f(cfg.extraPremium?'是':'否'); if(ep) ep.click();
  }, CONFIG);
  await sleep(600);
  await page.evaluate(() => {
    for (const l of [...document.querySelectorAll('label')]) { if (l.innerText.trim()==='年繳'||l.innerText.trim()==='年缴') { const r = l.closest('.MuiFormControl-root')?.querySelector('input[type="radio"]'); if(r) r.click(); break; } }
  });
  await sleep(600);
  const saI = page.locator('input[type="text"]').nth(2);
  if (await saI.count()) { await saI.click({force:true}); await sleep(50); await saI.fill(String(CONFIG.sumAssured)); }
  console.log('保额:', CONFIG.sumAssured);
  await sleep(1500); await wait();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(300); await clickNxt(); await sleep(1500); await wait();
  tick('Step3');

  // Step 4: riders
  console.log('\n--- Step 4: 附加 ---');
  await sleep(1500); await wait();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await clickNxt(); await sleep(1500); await wait();
  tick('Step4');

  // Step 5: summary
  console.log('\n--- Step 5: 概要 ---');
  await sleep(2000); await wait();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await clickNxt(); await sleep(1500); await wait();
  tick('Step5');

  // Step 6: options (names)
  console.log('\n--- Step 6: 选项 ---');
  await sleep(500);
  await page.evaluate(p => {
    const s = (el,v) => { const x=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; x.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
    for (const [n,v] of Object.entries({lastName:p.insuredSurname,firstName:p.insuredGivenName,payorName:p.payorSurname,payorFirst:p.payorGivenName})) {
      const i = document.querySelector(`input[name="${n}"]`); if(i) s(i,v);
    }
  }, CONFIG);
  console.log('姓名已填');
  await sleep(500); await clickNxt(); await sleep(1500); await wait();
  tick('Step6');

  // Steps 7-9: brute force to PDF
  for (let r = 1; r <= 5; r++) {
    console.log(`\n--- Round ${r} ---`);
    tick(`Round${r}`);

    if (r > 1) {
      await page.evaluate(p => {
        const s = (el,v) => { const x=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; x.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
        for (const [n,v] of Object.entries({lastName:p.insuredSurname,firstName:p.insuredGivenName,payorName:p.payorSurname,payorFirst:p.payorGivenName})) {
          const i = document.querySelector(`input[name="${n}"]`); if(i) s(i,v);
        }
      }, CONFIG);
      await sleep(300);
    }

    await page.evaluate(() => {
      for (const b of document.querySelectorAll('.MuiDialog-root button')) {
        if (/^(確認|Confirm|确定|確定|OK|接受|Accept)$/.test(b.innerText.trim())) b.click();
      }
    });
    await sleep(1200);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(200); await clickNxt(); await sleep(2000);

    await page.evaluate(() => {
      for (const b of document.querySelectorAll('.MuiDialog-root button')) {
        if (/^(確認|Confirm|确定|確定|OK|接受|Accept)$/.test(b.innerText.trim())) b.click();
      }
    });
    await sleep(2000);

    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (/檢視詳盡|詳盡建議|View/.test(b.innerText)) { b.click(); return; }
      }
    });
    await sleep(4000);

    for (const pg of ctx.pages()) {
      const f = pg.frames().find(fr => fr.url().includes('viewer.html'));
      if (f) {
        console.log('✅ PDF viewer!');
        const dp = page.waitForEvent('download', {timeout:40000});
        await f.locator('#download').evaluate(el => el.click());
        const dl = await dp;
        const fp = path.join(CONFIG.outputDir, FN);
        fs.copyFileSync(await dl.path(), fp);
        console.log(`\n✅ PDF: ${fp} (${fs.statSync(fp).size} bytes)`);
        tick('总耗时');
        await automationSession.close();
        automationSession = undefined;
        return;
      }
    }
  }
  throw new Error('5轮未找到 PDF');
}

main().catch(async e => {
  await automationSession?.close().catch(() => {});
  console.error('❌', e.message);
  process.exitCode = 1;
});
