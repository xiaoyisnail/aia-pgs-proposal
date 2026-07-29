#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateIrrReport } from './irr-report.mjs';
import {
  buildIrrSummaryImagePath,
  buildIrrWorkbookPath,
} from './proposal-files.mjs';
import { generateSavingsAnalysisFromPdfFiles } from './savings-analysis.mjs';

class ExistingProposalError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'ExistingProposalError';
    this.code = code;
  }
}

function requiredOptionValue(argumentsList, index, option) {
  const value = argumentsList[index + 1];
  if (!value || value.startsWith('--')) {
    throw new ExistingProposalError(
      'EXISTING_PDF_OPTION_VALUE_REQUIRED',
      `${option} 后必须提供值`,
    );
  }
  return value;
}

export function parseExistingProposalArguments(argumentsList) {
  const options = {
    irr: false,
    summary: false,
    analysis: false,
    outputDirectory: '',
    analysisOutputPath: '',
    insuredName: '',
    pdfPaths: [],
    help: false,
  };
  for (let index = 0; index < argumentsList.length; index++) {
    const argument = argumentsList[index];
    if (argument === '--irr') options.irr = true;
    else if (argument === '--summary') options.summary = true;
    else if (argument === '--analysis') options.analysis = true;
    else if (argument === '--all') {
      options.irr = true;
      options.summary = true;
      options.analysis = true;
    } else if (argument === '--output-dir') {
      options.outputDirectory = requiredOptionValue(
        argumentsList,
        index,
        argument,
      );
      index++;
    } else if (argument === '--analysis-output') {
      options.analysisOutputPath = requiredOptionValue(
        argumentsList,
        index,
        argument,
      );
      index++;
    } else if (argument === '--insured-name') {
      options.insuredName = requiredOptionValue(
        argumentsList,
        index,
        argument,
      );
      index++;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument.startsWith('--')) {
      throw new ExistingProposalError(
        'EXISTING_PDF_OPTION_UNKNOWN',
        `不支持的参数：${argument}`,
      );
    } else {
      options.pdfPaths.push(argument);
    }
  }
  if (options.help) return options;
  if (!options.pdfPaths.length) {
    throw new ExistingProposalError(
      'EXISTING_PDF_REQUIRED',
      '至少提供 1 份储蓄险计划书 PDF',
    );
  }
  if (!options.irr && !options.summary && !options.analysis) {
    if (options.pdfPaths.length === 1) {
      options.irr = true;
      options.summary = true;
    } else {
      options.analysis = true;
    }
  }
  if (options.analysis && options.pdfPaths.length < 2) {
    throw new ExistingProposalError(
      'EXISTING_PDF_ANALYSIS_INPUT_REQUIRED',
      '分析书至少需要 1 份不提领和 1 份提领计划书 PDF',
    );
  }
  if (options.analysisOutputPath && !options.analysis) {
    throw new ExistingProposalError(
      'EXISTING_PDF_ANALYSIS_NOT_REQUESTED',
      '--analysis-output 只能与 --analysis 或 --all 一起使用',
    );
  }
  return options;
}

function outputPathFor(sourcePdfPath, outputDirectory, buildDefaultPath) {
  const defaultPath = buildDefaultPath(sourcePdfPath);
  return outputDirectory
    ? path.join(path.resolve(outputDirectory), path.basename(defaultPath))
    : defaultPath;
}

async function assertPdfFile(pdfPath) {
  const resolvedPath = path.resolve(pdfPath);
  let bytes;
  try {
    bytes = await fs.readFile(resolvedPath);
  } catch (error) {
    throw new ExistingProposalError(
      'EXISTING_PDF_READ_FAILED',
      `无法读取 ${resolvedPath}：${error.message}`,
    );
  }
  if (bytes.length < 10_000 || bytes.subarray(0, 5).toString() !== '%PDF-') {
    throw new ExistingProposalError(
      'EXISTING_PDF_INVALID',
      `文件不是有效计划书 PDF 或内容过小：${resolvedPath}`,
    );
  }
  return resolvedPath;
}

function printHelp() {
  console.log(`处理已有储蓄险计划书 PDF：

  npm run from-pdf -- [输出选项] [路径选项] "<计划书.pdf>" [...]

输出选项：
  --irr       为每份 PDF 生成详细 IRR Excel
  --summary   为每份 PDF 生成简略收益说明图
  --analysis  用多份 PDF 生成一份储蓄分析书
  --all       同时执行以上三项

路径选项：
  --output-dir "<目录>"         保存 IRR 表、说明图及默认分析书
  --analysis-output "<文件.pdf>" 指定分析书文件路径
  --insured-name "<显示名称>"    分析书显示名称；省略时显示“受保人”

默认行为：
  单份 PDF = --irr --summary
  多份 PDF = --analysis`);
}

export async function processExistingProposals(options) {
  const pdfPaths = [];
  for (const inputPath of options.pdfPaths) {
    pdfPaths.push(await assertPdfFile(inputPath));
  }
  if (new Set(pdfPaths).size !== pdfPaths.length) {
    throw new ExistingProposalError(
      'EXISTING_PDF_DUPLICATE_INPUT',
      '输入包含重复的 PDF 路径',
    );
  }
  if (options.outputDirectory) {
    await fs.mkdir(path.resolve(options.outputDirectory), { recursive: true });
  }

  const irrPaths = [];
  const summaryPaths = [];
  if (options.irr || options.summary) {
    for (const pdfPath of pdfPaths) {
      const workbookPath = outputPathFor(
        pdfPath,
        options.outputDirectory,
        buildIrrWorkbookPath,
      );
      const summaryImagePath = outputPathFor(
        pdfPath,
        options.outputDirectory,
        buildIrrSummaryImagePath,
      );
      const result = await generateIrrReport(pdfPath, workbookPath, {
        generateWorkbook: options.irr,
        generateSummaryImage: options.summary,
        summaryImagePath,
      });
      if (result.outputPath) {
        irrPaths.push(result.outputPath);
        console.log(`✅ IRR 表: ${result.outputPath}`);
      }
      if (result.summaryImagePath) {
        summaryPaths.push(result.summaryImagePath);
        console.log(`✅ IRR 说明图: ${result.summaryImagePath}`);
      }
    }
  }

  let analysis = null;
  if (options.analysis) {
    analysis = await generateSavingsAnalysisFromPdfFiles({
      pdfPaths,
      outputPath: options.analysisOutputPath || undefined,
      outputDirectory: options.outputDirectory || undefined,
      insuredName: options.insuredName || undefined,
    });
    console.log(`✅ 储蓄分析书: ${analysis.outputPath}`);
  }
  console.log(
    `EXISTING_PDF_OUTPUT_OK pdfs=${pdfPaths.length} irr=${irrPaths.length} `
    + `images=${summaryPaths.length} analysis=${analysis ? 1 : 0}`,
  );
  return {
    pdfPaths,
    irrPaths,
    summaryPaths,
    analysisPath: analysis?.outputPath || null,
  };
}

async function main() {
  const options = parseExistingProposalArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  await processExistingProposals(options);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(error => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  });
}
