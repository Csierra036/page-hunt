// GET /api/capture?url=...&w=...: renders a public page in a fresh headless Chromium
// context (no cookies, no stored sessions) and returns two screenshots plus the
// rectangles of its breakable pieces. Used only by the "visual simulation" mode:
// the game never touches the real page after this.
// Adapted from hotshot-destroy/server/capture.ts.
import { existsSync, readFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { checkPublicUrl, isPublicHost, UserError } from './net';

const EXTRACT = readFileSync(new URL('./extract.js', import.meta.url), 'utf8');
const MAX_BLOCKS = 650;
const MAX_HEIGHT = 5000;
const VIEW_H = 800;

const CHROME_PATHS = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

export interface CaptureBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  cat: 'box' | 'control' | 'media' | 'text' | 'title';
}

export interface Capture {
  url: string;
  title: string;
  width: number;
  height: number;
  blocks: CaptureBlock[];
  full: string;
  bg: string;
}

export const chromiumPath = () => CHROME_PATHS.find((p) => p && existsSync(p));

let browser: Promise<Browser> | null = null;

function getBrowser() {
  if (!browser) {
    const executablePath = chromiumPath();
    if (!executablePath) throw new UserError('no-chromium', 'No hay Chromium instalado en el servidor: la simulación visual no está disponible (define CHROMIUM_PATH).');
    browser = chromium.launch({ executablePath }).catch((e) => {
      browser = null;
      throw new UserError('no-chromium', `No se pudo iniciar Chromium: ${e.message}`);
    });
  }
  return browser;
}

// One capture at a time: each one is a full browser page.
let queue: Promise<unknown> = Promise.resolve();

export function capture(raw: string, width: number): Promise<Capture> {
  const run = queue.then(() => doCapture(raw, width));
  queue = run.catch(() => {});
  return run;
}

async function doCapture(raw: string, width: number): Promise<Capture> {
  const url = await checkPublicUrl(raw);
  const ctx = await (await getBrowser()).newContext({
    viewport: { width, height: VIEW_H },
    deviceScaleFactor: 1,
    javaScriptEnabled: true,
    acceptDownloads: false,
    serviceWorkers: 'block',
    permissions: [],
  });
  try {
    // Every request the page makes (redirects, scripts, images...) must go to a public host.
    await ctx.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !(await isPublicHost(u.hostname))) return route.abort('blockedbyclient');
      return route.continue();
    });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    let response;
    try {
      // Only the document is required; slow videos, ads or trackers must not block the capture.
      response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    } catch (e) {
      throw new UserError('load', `La página no respondió a tiempo (${(e as Error).message.split('\n')[0]}).`);
    }
    await page.waitForLoadState('load', { timeout: 12_000 }).catch(() => {});
    if (response && response.status() >= 400) {
      throw new UserError('status', `El sitio respondió con el código ${response.status()}; no hay una página que capturar.`);
    }
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    // Scroll through the top of the page so lazy images load, drop fixed overlays (cookie banners, modals).
    const docH: number = await page.evaluate(`(async () => {
      const limit = ${MAX_HEIGHT};
      // Smooth scrolling would animate every scrollTo below and leave the page mid-way.
      document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
      if (document.body) document.body.style.setProperty('scroll-behavior', 'auto', 'important');
      for (let y = 0; y < Math.min(document.documentElement.scrollHeight, limit); y += innerHeight * 0.8) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
        // Only things that identify as overlays are dropped; other fixed content (like a
        // full-screen hero) is real content and is pinned to where it sits at the top.
        const id = (el.id || '') + ' ' + (el.getAttribute('class') || '');
        const dialog = el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true';
        if (dialog || /cookie|consent|gdpr|onetrust|cmp-|modal|popup|newsletter/i.test(id)) el.remove();
        else el.style.setProperty('position', cs.position === 'sticky' ? 'relative' : 'absolute', 'important');
      }
      document.documentElement.style.overflow = 'hidden';
      scrollTo({ top: 0, left: 0, behavior: 'instant' });
      for (let i = 0; i < 20 && (scrollY !== 0 || scrollX !== 0); i++) {
        scrollTo({ top: 0, left: 0, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 50));
      }
      return Math.min(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, innerHeight), limit);
    })()`);
    // Jump animations and transitions to their end state. Removing them instead would leave
    // fade-in content (opacity: 0 until animated) invisible in the capture.
    await page
      .addStyleTag({
        content: `*,*::before,*::after{animation-duration:1ms!important;animation-delay:0s!important;animation-iteration-count:1!important;
          transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}`,
      })
      .catch(() => {});
    await page.waitForTimeout(400);
    const height = Math.ceil(docH);

    let data: { title: string; blocks: CaptureBlock[] } | null = null;
    for (const chunk of [90, 180, 320, 600]) {
      data = (await page.evaluate(EXTRACT.replace('__MAX_CHUNK__', String(chunk)).replace('__LIMIT__', String(height)))) as typeof data;
      if (data!.blocks.filter((b) => b.cat !== 'box').length <= MAX_BLOCKS) break;
    }
    data!.blocks = data!.blocks.slice(0, MAX_BLOCKS + 140);

    const clip = { x: 0, y: 0, width, height };
    const full = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: true, clip });
    await page.addStyleTag({
      content: `*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important}
        *::placeholder{color:transparent!important}[data-hb]{visibility:hidden!important}`,
    });
    const bg = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: true, clip });
    return {
      url: page.url(),
      title: data!.title,
      width,
      height,
      blocks: data!.blocks,
      full: `data:image/jpeg;base64,${full.toString('base64')}`,
      bg: `data:image/jpeg;base64,${bg.toString('base64')}`,
    };
  } finally {
    await ctx.close();
  }
}
