import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseExistingProposalArguments,
} from '../scripts/process-existing-proposals.mjs';

test('单份已有 PDF 默认生成 IRR 表和说明图', () => {
  const options = parseExistingProposalArguments(['/tmp/plan.pdf']);
  assert.equal(options.irr, true);
  assert.equal(options.summary, true);
  assert.equal(options.analysis, false);
});

test('多份已有 PDF 默认生成分析书', () => {
  const options = parseExistingProposalArguments([
    '/tmp/baseline.pdf',
    '/tmp/withdrawal.pdf',
  ]);
  assert.equal(options.irr, false);
  assert.equal(options.summary, false);
  assert.equal(options.analysis, true);
});

test('已有 PDF 输出项和路径可以按用户要求组合', () => {
  const options = parseExistingProposalArguments([
    '--all',
    '--output-dir',
    '/tmp/output',
    '--analysis-output',
    '/tmp/report.pdf',
    '--insured-name',
    '张先生',
    '/tmp/baseline.pdf',
    '/tmp/withdrawal.pdf',
  ]);
  assert.equal(options.irr, true);
  assert.equal(options.summary, true);
  assert.equal(options.analysis, true);
  assert.equal(options.outputDirectory, '/tmp/output');
  assert.equal(options.analysisOutputPath, '/tmp/report.pdf');
  assert.equal(options.insuredName, '张先生');
});

test('分析书拒绝只有一份 PDF', () => {
  assert.throws(
    () => parseExistingProposalArguments([
      '--analysis',
      '/tmp/plan.pdf',
    ]),
    /EXISTING_PDF_ANALYSIS_INPUT_REQUIRED/,
  );
});
