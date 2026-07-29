#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PROPOSAL_ROOT,
  productNameFromProposalFile,
  toSimplified,
} from './proposal-files.mjs';

export async function planProposalMoves(rootDirectory = DEFAULT_PROPOSAL_ROOT) {
  const entries = await fs.readdir(rootDirectory, { withFileTypes: true });
  const moves = [];
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.pdf') continue;
    const simplifiedName = toSimplified(entry.name);
    const productName = productNameFromProposalFile(simplifiedName);
    const sourcePath = path.join(rootDirectory, entry.name);
    const targetPath = path.join(rootDirectory, productName, simplifiedName);
    moves.push({ sourcePath, targetPath, productName });
  }
  moves.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, 'zh-CN'));
  return moves;
}

export async function organizeProposals(rootDirectory = DEFAULT_PROPOSAL_ROOT, dryRun = false) {
  const moves = await planProposalMoves(rootDirectory);
  const targetPaths = new Set();
  for (const move of moves) {
    if (targetPaths.has(move.targetPath)) {
      throw new Error(`目标文件名冲突：${move.targetPath}`);
    }
    targetPaths.add(move.targetPath);
    try {
      await fs.access(move.targetPath);
      throw new Error(`目标文件已存在，未移动任何文件：${move.targetPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (dryRun) return moves;
  for (const move of moves) {
    await fs.mkdir(path.dirname(move.targetPath), { recursive: true });
    await fs.rename(move.sourcePath, move.targetPath);
  }
  return moves;
}

async function main() {
  const rootArgument = process.argv.slice(2).find(argument => !argument.startsWith('--'));
  const rootDirectory = path.resolve(rootArgument || DEFAULT_PROPOSAL_ROOT);
  const dryRun = process.argv.includes('--dry-run');
  const moves = await organizeProposals(rootDirectory, dryRun);
  for (const move of moves) {
    console.log(`${dryRun ? 'DRY_RUN' : 'MOVED'} ${move.sourcePath} -> ${move.targetPath}`);
  }
  console.log(`${dryRun ? 'ORGANIZE_DRY_RUN_OK' : 'ORGANIZE_OK'} count=${moves.length}`);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(error => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  });
}
