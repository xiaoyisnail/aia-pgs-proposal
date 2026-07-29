#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { qualifiesForLargeSavingsAnalysis } from './savings-analysis.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const singleProposalScript = path.join(scriptDirectory, 'generate-proposal.mjs');
const largeSavingsScript = path.join(scriptDirectory, 'generate-large-savings.mjs');

function parameterFileFromArguments(argumentsList) {
  return argumentsList.find(argument => !argument.startsWith('--'));
}

function shouldUseLargeSavingsFlow(argumentsList) {
  const parameterFile = parameterFileFromArguments(argumentsList);
  if (!parameterFile || !fs.existsSync(parameterFile)) return false;
  try {
    const config = JSON.parse(fs.readFileSync(parameterFile, 'utf8'));
    return qualifiesForLargeSavingsAnalysis(config);
  } catch {
    return false;
  }
}

function run(scriptPath, argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...argumentsList], {
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
      reject(new Error(
        signal
          ? `生成流程被信号 ${signal} 中断`
          : `生成流程退出码 ${code}`,
      ));
    });
  });
}

const argumentsList = process.argv.slice(2);
const target = shouldUseLargeSavingsFlow(argumentsList)
  ? largeSavingsScript
  : singleProposalScript;

run(target, argumentsList).catch(error => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
