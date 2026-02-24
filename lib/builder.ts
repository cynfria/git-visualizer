import { execSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';

const MAX_BUILD_TIME_MS = 90_000;
const MAX_DISK_MB = 500;
const POLL_INTERVAL_MS = 2000;

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

export async function cloneAndBuild(
  owner: string,
  repo: string,
  branch: string,
  destDir: string,
  token: string
): Promise<{ port: number; process: ChildProcess; log: string }> {
  const cloneUrl = `https://${token}:x-oauth-basic@github.com/${owner}/${repo}.git`;

  // Shallow clone
  execSync(
    `git clone --depth=1 --branch "${branch}" "${cloneUrl}" "${destDir}"`,
    { timeout: 60_000, stdio: 'pipe' }
  );

  // Check disk usage
  const du = execSync(`du -sm "${destDir}"`, { stdio: 'pipe' }).toString();
  const mb = parseInt(du.split('\t')[0]);
  if (mb > MAX_DISK_MB) {
    fs.rmSync(destDir, { recursive: true, force: true });
    throw new Error(`Clone too large: ${mb}MB (max ${MAX_DISK_MB}MB)`);
  }

  // Detect project type
  const pkgPath = path.join(destDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error('No package.json found — cannot build');
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const hasBuild = !!pkg.scripts?.build;
  const hasDev = !!pkg.scripts?.dev;
  const hasStart = !!pkg.scripts?.start;

  // Install dependencies
  execSync('npm install --prefer-offline --legacy-peer-deps', {
    cwd: destDir,
    timeout: MAX_BUILD_TIME_MS,
    stdio: 'pipe',
  });

  const port = await getFreePort();
  let log = '';

  let serverProcess: ChildProcess;

  if (hasBuild) {
    // Build first, then start
    execSync('npm run build', {
      cwd: destDir,
      timeout: MAX_BUILD_TIME_MS,
      stdio: 'pipe',
      env: { ...process.env, PORT: String(port), NODE_ENV: 'production' },
    });

    const startScript = hasStart ? 'start' : 'dev';
    serverProcess = spawn('npm', ['run', startScript], {
      cwd: destDir,
      env: { ...process.env, PORT: String(port), NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else if (hasDev) {
    serverProcess = spawn('npm', ['run', 'dev'], {
      cwd: destDir,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    throw new Error('No build, dev, or start script found in package.json');
  }

  serverProcess.stdout?.on('data', (d: Buffer) => { log += d.toString(); });
  serverProcess.stderr?.on('data', (d: Buffer) => { log += d.toString(); });

  return { port, process: serverProcess, log };
}

export async function waitForServer(port: number, timeoutMs = MAX_BUILD_TIME_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return;
    } catch {}
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Server on port ${port} did not respond within ${timeoutMs / 1000}s`);
}

export function cleanup(dirs: string[], processes: ChildProcess[]) {
  for (const proc of processes) {
    try { proc.kill('SIGKILL'); } catch {}
  }
  for (const dir of dirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
