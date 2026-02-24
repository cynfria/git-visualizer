import { NextRequest, NextResponse } from 'next/server';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { cloneAndBuild, waitForServer, cleanup } from '@/lib/builder';
import { screenshot, diffScreenshots, bufferToBase64 } from '@/lib/screenshotter';
import type { DiffResult } from '@/types';
import type { ChildProcess } from 'child_process';

const TOTAL_TIMEOUT_MS = 90_000;

export async function POST(req: NextRequest) {
  const { owner, repo, branch, token } = await req.json();

  if (!owner || !repo || !branch) {
    return NextResponse.json({ error: 'owner, repo, and branch are required' }, { status: 400 });
  }

  const id = uuidv4();
  const mainDir = path.join(os.tmpdir(), `${id}-main`);
  const branchDir = path.join(os.tmpdir(), `${id}-branch`);
  const processes: ChildProcess[] = [];
  let buildLog = '';

  const result: DiffResult = {
    success: false,
    mainScreenshot: null,
    branchScreenshot: null,
    diffImage: null,
    changedPixels: null,
    totalPixels: null,
    errorMessage: null,
    buildLog: null,
  };

  const timeoutSignal = AbortSignal.timeout(TOTAL_TIMEOUT_MS);

  try {
    // Build main
    const mainBuild = await cloneAndBuild(owner, repo, 'main', mainDir, token);
    processes.push(mainBuild.process);
    buildLog += `\n--- main ---\n${mainBuild.log}`;

    // Build branch
    const branchBuild = await cloneAndBuild(owner, repo, branch, branchDir, token);
    processes.push(branchBuild.process);
    buildLog += `\n--- ${branch} ---\n${branchBuild.log}`;

    // Wait for both servers
    await Promise.all([
      waitForServer(mainBuild.port),
      waitForServer(branchBuild.port),
    ]);

    // Screenshot both
    const [mainBuf, branchBuf] = await Promise.all([
      screenshot(`http://localhost:${mainBuild.port}`),
      screenshot(`http://localhost:${branchBuild.port}`),
    ]);

    const { diffImage, changedPixels, totalPixels } = diffScreenshots(mainBuf, branchBuf);

    result.success = true;
    result.mainScreenshot = bufferToBase64(mainBuf);
    result.branchScreenshot = bufferToBase64(branchBuf);
    result.diffImage = bufferToBase64(diffImage);
    result.changedPixels = changedPixels;
    result.totalPixels = totalPixels;
  } catch (err) {
    result.errorMessage = err instanceof Error ? err.message : 'Unknown error';
    result.buildLog = buildLog.slice(-3000); // cap at 3k chars
  } finally {
    cleanup([mainDir, branchDir], processes);
  }

  result.buildLog = buildLog.slice(-3000);
  return NextResponse.json(result);
}
