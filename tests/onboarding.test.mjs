import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('macOS bootstrap installs a private checksummed Node runtime then onboards', () => {
  const script = read('scripts/bootstrap.sh');
  assert.match(script, /uname -s.*Darwin/);
  assert.match(script, /latest-v22\.x\/SHASUMS256\.txt/);
  assert.match(script, /shasum -a 256/);
  assert.match(script, /\.runtime\/node/);
  assert.match(script, /npm run onboard -- "\$@"/);
});

test('Windows bootstrap installs a private checksummed Node runtime then onboards', () => {
  const script = read('scripts/bootstrap.ps1');
  assert.match(script, /PROCESSOR_ARCHITECTURE/);
  assert.match(script, /latest-v22\.x\/SHASUMS256\.txt/);
  assert.match(script, /Get-FileHash -Algorithm SHA256/);
  assert.match(script, /Expand-Archive/);
  assert.match(script, /npm\.cmd run onboard -- @OnboardArgs/);
});

test('Windows cmd wrapper avoids requiring a permanent execution-policy change', () => {
  const script = read('scripts/bootstrap.cmd');
  assert.match(script, /-ExecutionPolicy Bypass/);
  assert.match(script, /bootstrap\.ps1/);
  assert.match(script, /%\*/);
});

test('onboarding never accepts passwords or OTP through command arguments', () => {
  const script = read('scripts/onboard.mjs');
  assert.doesNotMatch(script, /--password|--otp|AGENCY_PASSWORD/);
  assert.match(script, /scripts\/setup\.mjs/);
  assert.match(script, /--username/);
  assert.match(script, /--setup-outlook/);
  assert.match(script, /--fresh-login/);
  assert.match(script, /ONBOARDING_OK/);
});
