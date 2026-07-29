#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { extractSavingsProposalData } from './irr-report.mjs';
import {
  buildSavingsAnalysisPath,
  resolveProposalOutput,
} from './proposal-files.mjs';
import {
  buildLargeSavingsScenarioConfigs,
  generateSavingsAnalysisPdf,
  qualifiesForLargeSavingsAnalysis,
  SavingsAnalysisError,
} from './savings-analysis.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const singleProposalScript = path.join(scriptDirectory, 'generate-proposal.mjs');

function parameterFileFromArguments(argumentsList) {
  return argumentsList.find(argument => !argument.startsWith('--'));
}

async function readConfig(parameterFile) {
  if (!parameterFile) {
    throw new SavingsAnalysisError(
      'PARAMS_REQUIRED',
      '缺少参数文件。请运行 npm run generate -- params.json',
    );
  }
  let input;
  try {
    input = JSON.parse(await fs.readFile(parameterFile, 'utf8'));
  } catch (error) {
    throw new SavingsAnalysisError(
      'PARAMS_INVALID_JSON',
      `无法读取参数文件：${error.message}`,
    );
  }
  if (!qualifiesForLargeSavingsAnalysis(input)) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_NOT_APPLICABLE',
      '大单储蓄分析仅适用于美元年缴保费达到 50,000 的储蓄险',
    );
  }
  if (input.age > 75) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_AGE_UNSUPPORTED',
      '五档方案最晚从第 25 保单年度开始，受保人投保年龄不能超过 75 岁',
    );
  }
  return input;
}

function runSingleProposal(configPath, freshLogin) {
  const argumentsList = freshLogin
    ? ['--fresh-login', configPath]
    : [configPath];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [singleProposalScript, ...argumentsList], {
      cwd: process.cwd(),
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new SavingsAnalysisError(
        'SAVINGS_ANALYSIS_PROPOSAL_FAILED',
        signal
          ? `单份计划书流程被信号 ${signal} 中断`
          : `单份计划书流程退出码 ${code}`,
      ));
    });
  });
}

async function writeScenarioConfig(directory, fileName, config) {
  const configPath = path.join(directory, fileName);
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  return configPath;
}

async function assertGeneratedFiles(output, label, requireSummaryImage) {
  const requiredFiles = [
    ['PDF', output.pdfPath],
    ['IRR 表', output.irrWorkbookPath],
  ];
  if (requireSummaryImage) {
    requiredFiles.push(['IRR 说明图', output.irrSummaryImagePath]);
  }
  for (const [kind, filePath] of requiredFiles) {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      throw new SavingsAnalysisError(
        'SAVINGS_ANALYSIS_OUTPUT_MISSING',
        `${label}缺少${kind}：${filePath}`,
      );
    }
    if (!stat.isFile() || stat.size <= 0) {
      throw new SavingsAnalysisError(
        'SAVINGS_ANALYSIS_OUTPUT_INVALID',
        `${label}${kind}无效：${filePath}`,
      );
    }
  }
}

async function generateScenarioWithRetry({
  configPath,
  freshLogin,
  output,
  label,
  requireSummaryImage,
}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await runSingleProposal(configPath, freshLogin && attempt === 1);
      await assertGeneratedFiles(output, label, requireSummaryImage);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      console.log(
        `\n⚠️ ${label}第 ${attempt} 次失败，等待 8 秒后用全新独立 Chrome 重试`,
      );
      await new Promise(resolve => setTimeout(resolve, 8_000));
    }
  }
  throw lastError;
}

async function main() {
  const argumentsList = process.argv.slice(2);
  const parameterFile = parameterFileFromArguments(argumentsList);
  const baseConfig = await readConfig(parameterFile);
  const freshLogin = argumentsList.includes('--fresh-login');
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'aia-pgs-large-savings-'),
  );
  try {
    console.log(
      '📚 大单储蓄模式：自动生成 1 份不提领 + 5 份提领计划书、6 份 IRR 表、1 张不提领说明图和 1 份分析书',
    );
    const baselineConfig = {
      ...baseConfig,
      largeSavingsBatchRole: 'baseline',
      withdrawalPlan: { enabled: false },
    };
    const baselineConfigPath = await writeScenarioConfig(
      temporaryDirectory,
      '00-baseline.json',
      baselineConfig,
    );
    console.log('\n═══ 大单方案 0/5：不提领基准 ═══');
    const baselineOutput = resolveProposalOutput(baselineConfig);
    await generateScenarioWithRetry({
      configPath: baselineConfigPath,
      freshLogin,
      output: baselineOutput,
      label: '不提领基准',
      requireSummaryImage: true,
    });
    await new Promise(resolve => setTimeout(resolve, 5_000));
    const baselineData = await extractSavingsProposalData(baselineOutput.pdfPath);
    const actualTotalPremium = baselineData.annualPremium * baselineData.premiumTerm;
    if (baselineData.rows.at(-1).policyYear < 25) {
      throw new SavingsAnalysisError(
        'SAVINGS_ANALYSIS_POLICY_TERM_TOO_SHORT',
        '当前计划书不足 25 个保单年度，无法生成参考模板要求的五档提领方案',
      );
    }

    const scenarioConfigs = buildLargeSavingsScenarioConfigs(
      baselineConfig,
      actualTotalPremium,
    );
    const withdrawalEntries = [];
    for (let index = 0; index < scenarioConfigs.length; index++) {
      const config = scenarioConfigs[index];
      const ratioPercent = (config.analysisScenario.totalPremiumRatio * 100)
        .toFixed(1)
        .replace(/\.0$/, '');
      console.log(
        `\n═══ 大单方案 ${index + 1}/5：第 ${config.withdrawalPlan.startPolicyYear} 年起，`
        + `每年提取 USD ${config.withdrawalPlan.annualAmount}（总保费 ${ratioPercent}%） ═══`,
      );
      const configPath = await writeScenarioConfig(
        temporaryDirectory,
        `${String(index + 1).padStart(2, '0')}-withdrawal.json`,
        config,
      );
      const output = resolveProposalOutput(config);
      await generateScenarioWithRetry({
        configPath,
        freshLogin: false,
        output,
        label: `第 ${index + 1} 档提领方案`,
        requireSummaryImage: false,
      });
      await new Promise(resolve => setTimeout(resolve, 5_000));
      withdrawalEntries.push({
        config,
        pdfPath: output.pdfPath,
      });
    }

    const outputPath = buildSavingsAnalysisPath(baselineConfig);
    const analysis = await generateSavingsAnalysisPdf({
      baseConfig: baselineConfig,
      baselinePdfPath: baselineOutput.pdfPath,
      withdrawalEntries,
      outputPath,
    });
    console.log(`\n✅ 大单储蓄分析书: ${analysis.outputPath}`);
    console.log(
      `LARGE_SAVINGS_ANALYSIS_OK proposals=${analysis.proposalCount} analysis="${analysis.outputPath}"`,
    );
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
