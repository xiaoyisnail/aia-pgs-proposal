import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDefaultChromeDir } from '../scripts/runtime-platform.mjs';
import { openIpgs } from '../scripts/generate-proposal.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('activates the focused iPGS+ anchor even if a pointer click misses after layout shifts', async () => {
  const pgs = { url: () => 'https://aiahk-apps.example.test/pgs/index', isClosed: () => false, evaluate: async () => true };
  const pages = [];
  const agency = {
    url: () => 'https://aiahk-blob01-prd.aia.com.hk/agency/zh-hk/electronic',
    isClosed: () => false,
    context: () => ({ pages: () => pages }),
    getByRole: () => ({ first: () => ({
      click: async () => {}, // The real pointer click reached a wrapper, not the anchor.
      press: async key => { assert.equal(key, 'Enter'); pages.push(pgs); },
    }) }),
  };
  pages.push(agency);
  assert.equal(await openIpgs(agency, { entryWaitMs: 800 }), pgs);
});

test('reloads the electronic services page once on the portal error without changing the context', async t => {
  const log = t.mock.method(console, 'log', () => {});
  const pgs = { url: () => 'https://aiahk-apps.example.test/pgs/index', isClosed: () => false, evaluate: async () => true };
  const pages = [];
  let reloads = 0;
  const agency = {
    url: () => 'https://aiahk-blob01-prd.aia.com.hk/agency/zh-hk/electronic',
    isClosed: () => false,
    context: () => ({ pages: () => pages }),
    reload: async () => { reloads++; },
    getByText: text => {
      assert.equal(text, '發生意外錯誤，請重試。');
      return { first: () => ({ isVisible: async () => true }) };
    },
    getByRole: () => ({ first: () => ({ press: async () => {
      if (!reloads) throw new Error('The error page has no link');
      pages.push(pgs);
    } }) }),
  };
  pages.push(agency);
  assert.equal(await openIpgs(agency, { entryWaitMs: 800 }), pgs);
  assert.equal(reloads, 1);
  assert.match(log.mock.calls[0].arguments[0], /IPGS_PORTAL_RETRY/);
});

test('keeps the signed-in Chrome context while waiting for a manual iPGS+ launch', async t => {
  const log = t.mock.method(console, 'log', () => {});
  const pgs = { url: () => 'https://aiahk-apps.example.test/pgs/index', isClosed: () => false, evaluate: async () => true };
  const pages = [pgs]; // A previous iPGS+ tab must not be mistaken for a fresh proposal.
  let current = 'https://aiahk-blob01-prd.aia.com.hk/agency/zh-hk/home';
  const freshPgs = { ...pgs };
  const agency = {
    url: () => current,
    goto: async url => { current = url; },
    isClosed: () => false,
    context: () => ({ pages: () => pages }),
    getByText: () => ({ first: () => ({ isVisible: async () => false }) }),
    getByRole: () => ({ first: () => ({ press: async () => {
      assert.match(current, /\/electronic$/);
      setTimeout(() => pages.push(freshPgs), 10);
      throw new Error('入口未就绪');
    } }) }),
  };
  pages.push(agency);
  assert.equal(await openIpgs(agency, { entryWaitMs: 2000 }), freshPgs);
  assert.match(log.mock.calls[0].arguments[0], /IPGS_MANUAL_ENTRY/);
});

function runNode(script, args, env = process.env) {
  return spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
}

test('validates multiple products in both categories without starting Chrome', () => {
  for (const example of [
    'examples/oys2-minor.json',
    'examples/eoys-critical-minor.json',
    'examples/gf-savings-child.json',
    'examples/gf-savings-withdrawal-child.json',
    'examples/gp3-savings-child.json',
  ]) {
    const result = runNode(
      'scripts/generate-proposal.mjs',
      ['--check-params', example],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PARAMS_OK/);
    assert.doesNotMatch(result.stdout, /独立自动化 Chrome 已启动/);
  }
});

test('rejects invalid savings parameters before starting Chrome', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aia-pgs-params-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const paramsPath = path.join(directory, 'invalid.json');
  const input = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'examples/gf-savings-child.json'), 'utf8'),
  );
  delete input.annualPremium;
  fs.writeFileSync(paramsPath, JSON.stringify(input));

  const result = runNode(
    'scripts/generate-proposal.mjs',
    ['--check-params', paramsPath],
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PARAMS_INVALID.*annualPremium/);
  assert.doesNotMatch(result.stdout, /独立自动化 Chrome 已启动/);
});

test('requires an explicit savings withdrawal decision before starting Chrome', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aia-pgs-withdrawal-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const paramsPath = path.join(directory, 'missing-withdrawal.json');
  const input = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'examples/gf-savings-child.json'), 'utf8'),
  );
  delete input.withdrawalPlan;
  fs.writeFileSync(paramsPath, JSON.stringify(input));

  const result = runNode(
    'scripts/generate-proposal.mjs',
    ['--check-params', paramsPath],
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PARAMS_INVALID.*withdrawalPlan\.enabled/);
  assert.doesNotMatch(result.stdout, /独立自动化 Chrome 已启动/);
});

test('rejects an invalid equal-withdrawal range before starting Chrome', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aia-pgs-withdrawal-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const paramsPath = path.join(directory, 'invalid-withdrawal.json');
  const input = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, 'examples/gf-savings-withdrawal-child.json'),
      'utf8',
    ),
  );
  input.withdrawalPlan.endPolicyYear = 5;
  fs.writeFileSync(paramsPath, JSON.stringify(input));

  const result = runNode(
    'scripts/generate-proposal.mjs',
    ['--check-params', paramsPath],
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PARAMS_INVALID.*endPolicyYear/);
  assert.doesNotMatch(result.stdout, /独立自动化 Chrome 已启动/);
});

test('requires a concrete product instead of defaulting from category', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aia-pgs-product-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const paramsPath = path.join(directory, 'missing-product.json');
  const input = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'examples/gf-savings-child.json'), 'utf8'),
  );
  delete input.productName;
  delete input.productCode;
  fs.writeFileSync(paramsPath, JSON.stringify(input));

  const result = runNode(
    'scripts/generate-proposal.mjs',
    ['--check-params', paramsPath],
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PARAMS_MISSING.*productName/);
  assert.doesNotMatch(result.stdout, /独立自动化 Chrome 已启动/);
});

test('environment check rejects overlapping profiles without requiring stored credentials', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aia-pgs-env-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const env = {
    ...process.env,
    AIA_PGS_CONFIG_PATH: path.join(directory, 'missing-config.json'),
    AIA_PGS_PROFILE_DIR: resolveDefaultChromeDir(),
  };

  const result = runNode('scripts/setup.mjs', ['--check'], env);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(output, /❌ Chrome profile 隔离/);
  assert.doesNotMatch(output, /Agency 用户编号|Agency 密码安全存储/);
  assert.match(output, /处理：/);
  assert.match(output, /SETUP_NOT_READY failed=/);
});
