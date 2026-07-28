import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDefaultChromeDir } from '../scripts/runtime-platform.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

test('environment check reports all actionable setup problems', t => {
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
  assert.match(output, /❌ Agency 用户编号/);
  assert.match(output, /处理：/);
  assert.match(output, /SETUP_NOT_READY failed=/);
});
