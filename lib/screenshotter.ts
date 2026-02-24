import puppeteer from 'puppeteer';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const VIEWPORT = { width: 1280, height: 900 };

export async function screenshot(url: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
    const buf = await page.screenshot({ fullPage: true, type: 'png' });
    return buf as Buffer;
  } finally {
    await browser.close();
  }
}

export function diffScreenshots(
  mainPng: Buffer,
  branchPng: Buffer
): { diffImage: Buffer; changedPixels: number; totalPixels: number } {
  const imgA = PNG.sync.read(mainPng);
  const imgB = PNG.sync.read(branchPng);

  // Normalize to same dimensions
  const width = Math.max(imgA.width, imgB.width);
  const height = Math.max(imgA.height, imgB.height);

  const out = new PNG({ width, height });
  const changedPixels = pixelmatch(
    imgA.data,
    imgB.data,
    out.data,
    imgA.width,
    imgA.height,
    { threshold: 0.1 }
  );

  return {
    diffImage: PNG.sync.write(out),
    changedPixels,
    totalPixels: width * height,
  };
}

export function bufferToBase64(buf: Buffer): string {
  return buf.toString('base64');
}
