// End-to-end checks in a real Chromium: `npm run test:e2e`.
// Starts the Vite dev server (with the game API), drives the game with real mouse
// and keyboard events and records what actually happened in tests/e2e/out/.
// Cases 2, 3 and 5 need Internet access (example.com, github.com).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const OUT = new URL('./out/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const PORT = 5288;
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROMIUM_PATH ?? ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].find((p) => existsSync(p));

const results = [];
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${id}] ${name} — ${detail}`);
}

const server = await createServer({ root: new URL('../..', import.meta.url).pathname, server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: CHROME ?? '/usr/bin/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
const expectedErrors = [];
const failedApi = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));
page.on('response', (r) => r.status() >= 400 && failedApi.push(`${r.status()} ${new URL(r.url()).pathname}`));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // The strict iframe sandbox blocks the external page's scripts on purpose; rejected URLs answer 400.
  if (/sandboxed and the 'allow-scripts' permission is not set/.test(t) || /status of 400/.test(t)) expectedErrors.push(t);
  else consoleErrors.push(t);
});

const sleep = (ms) => page.waitForTimeout(ms);
const state = () =>
  page.evaluate(() => {
    const g = window.__pageHunt.game;
    return {
      state: g.state,
      mode: g.stage?.mode ?? null,
      destruction: g.stage ? g.stage.destruction() : 0,
      ammo: g.weapon.ammo,
      weapon: g.weapon.def.id,
      reloading: g.weapon.reloading,
      jammed: g.weapon.jammed,
      points: g.score.points,
      broken: g.score.broken,
      shots: g.score.shots,
    };
  });
const fxBox = () => page.locator('#fx').boundingBox();
async function shoot(x, y, wait = 360) {
  const b = await fxBox();
  await page.mouse.move(b.x + x, b.y + y);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(wait);
}
async function submitUrl(url) {
  await page.fill('#url', url);
  await page.click('#url-form button[type=submit]');
  await page.waitForFunction(() => {
    const s = document.getElementById('url-status');
    return !s.classList.contains('busy') && (!document.getElementById('compat').classList.contains('hidden') || s.classList.contains('error'));
  }, null, { timeout: 30_000 });
  return page.evaluate(() => ({
    status: document.getElementById('url-status').textContent,
    error: document.getElementById('url-status').classList.contains('error'),
    input: document.getElementById('url').value,
    compat: document.getElementById('compat').classList.contains('hidden') ? null : document.getElementById('compat').innerText,
    modes: [...document.querySelectorAll('.mode-row')].map((r) => ({ mode: r.dataset.mode, ok: r.classList.contains('ok'), recommended: Boolean(r.querySelector('.tag')) })),
  }));
}
async function playMode(mode) {
  await page.click(`.mode-row[data-mode=${mode}] button`);
  await page.waitForFunction(() => document.getElementById('start').classList.contains('hidden') || document.getElementById('url-status').classList.contains('error'), null, { timeout: 60_000 });
  return page.evaluate(() => ({ badge: document.getElementById('mode-badge').textContent, error: document.getElementById('url-status').classList.contains('error') ? document.getElementById('url-status').textContent : null }));
}
async function changeUrl() {
  await page.click('#b-url');
  await sleep(200);
}
const shot = (name) => page.screenshot({ path: new URL(`${name}.png`, OUT).pathname });

async function safe(id, name, fn) {
  try {
    await fn();
  } catch (e) {
    record(id, name, false, `excepción: ${e.message.split('\n')[0]}`);
  }
}

await page.goto(BASE);
await page.waitForFunction(() => window.__pageHunt);
await shot('00-start');

// 1 + 7: own page, real DOM destruction, repeated hits on one element.
await safe(1, 'Página propia: destrucción real del DOM', async () => {
  const r = await submitUrl(`${BASE}/demo/`);
  const rec = r.modes.find((m) => m.recommended)?.mode;
  const p = await playMode('dom');
  const frame = page.frames().find((f) => f.url().includes('/demo/'));
  const h1 = await frame.locator('h1').boundingBox();
  const fx = await fxBox();
  const cx = h1.x - fx.x + h1.width / 2;
  const cy = h1.y - fx.y + h1.height / 2;
  const stages = [];
  let shots = 0;
  while (shots < 20) {
    await shoot(cx, cy, 220);
    shots++;
    const s = await frame.evaluate(() => {
      const h = document.querySelector('h1');
      return h.hasAttribute('data-ph-broken') ? 'broken' : h.getAttribute('data-ph-dmg') ?? '0';
    });
    stages.push(s);
    if (s === 'broken') break;
    if ((await state()).ammo === 0) {
      await page.keyboard.press('KeyR');
      await sleep(1300);
    }
  }
  await sleep(1300);
  const hidden = await frame.evaluate(() => getComputedStyle(document.querySelector('h1')).visibility);
  const st = await state();
  await shot('01-dom-demo');
  record(1, 'Página propia: destrucción real del DOM', rec === 'dom' && p.badge === 'DOM REAL' && stages.at(-1) === 'broken' && hidden === 'hidden',
    `modo recomendado=${rec}, insignia="${p.badge}", <h1> real: visibility=${hidden}, destrucción=${(st.destruction * 100).toFixed(1)}%`);
  record(7, 'Disparos repetidos sobre el mismo elemento', stages.at(-1) === 'broken' && new Set(stages).size >= 3,
    `estados de data-ph-dmg tras cada disparo de escopeta: ${stages.join(' → ')}`);

  // Scroll + dynamic content in DOM mode.
  const y0 = await frame.evaluate(() => scrollY);
  await page.mouse.wheel(0, 500);
  await sleep(300);
  const y1 = await frame.evaluate(() => scrollY);
  await page.mouse.wheel(0, -2000);
  await sleep(300);
  await frame.waitForFunction(() => document.querySelectorAll('#ticker .item').length >= 2, null, { timeout: 10_000 });
  const item = await frame.locator('#ticker .item').nth(1).boundingBox();
  const fx2 = await fxBox();
  await shoot(item.x - fx2.x + item.width / 2, item.y - fx2.y + item.height / 2);
  const dyn = await frame.evaluate(() => document.querySelectorAll('#ticker .item')[1].getAttribute('data-ph-dmg') ?? (document.querySelectorAll('#ticker .item')[1].hasAttribute('data-ph-broken') ? 'broken' : 'none'));
  record('1b', 'DOM real: desplazamiento y contenido dinámico', y1 > y0 && dyn !== 'none', `scrollY ${y0}→${y1} con la rueda; elemento añadido por script tras cargar: estado de daño=${dyn}`);
});

// 8: reload in different states.
await safe(8, 'Recarga en distintos estados', async () => {
  const notes = [];
  let ok = true;
  // Full magazine: refused.
  await page.click('#b-restart');
  await page.waitForFunction(() => window.__pageHunt.game.state === 'playing', null, { timeout: 20_000 });
  await page.mouse.move(640, 400);
  let s = await state();
  await page.keyboard.press('KeyR');
  await sleep(100);
  let s2 = await state();
  ok &&= !s2.reloading && s.ammo === s2.ammo;
  notes.push(`cargador lleno: recarga rechazada=${!s2.reloading}`);
  // Partial: reload starts and blocks firing; reloading itself does no damage.
  await shoot(640, 300, 250);
  s = await state();
  await page.keyboard.press('KeyR');
  await sleep(50);
  s2 = await state();
  await shoot(640, 300, 50);
  const s3 = await state();
  ok &&= s2.reloading && s3.shots === s2.shots && s2.destruction === s.destruction;
  notes.push(`media carga: recargando=${s2.reloading}, disparo bloqueado=${s3.shots === s2.shots}, la recarga no daña: ${(s.destruction * 100).toFixed(1)}%→${(s2.destruction * 100).toFixed(1)}%`);
  // Second press too early: jam.
  await page.keyboard.press('KeyR');
  await sleep(50);
  const s4 = await state();
  ok &&= s4.jammed;
  notes.push(`segunda pulsación fuera de la zona verde: encasquillada=${s4.jammed}`);
  await sleep(2000);
  // Empty magazine: reloads, still without damage.
  let fired = 0;
  while ((await state()).ammo > 0 && fired < 12) {
    await shoot(300 + fired * 40, 650, 200);
    fired++;
  }
  s = await state();
  await page.mouse.move(640, 450);
  await page.keyboard.press('KeyR');
  await sleep(100);
  s2 = await state();
  ok &&= s.ammo === 0 && s2.reloading && s2.destruction === s.destruction;
  notes.push(`cargador vacío: recargando=${s2.reloading}, sin daño ${(s.destruction * 100).toFixed(1)}%→${(s2.destruction * 100).toFixed(1)}%`);
  await sleep(1700); // the shotgun reload takes 1.5 s
  ok &&= (await state()).ammo > 0;
  await shot('08-reload');
  // Paused: ignored.
  await shoot(640, 300, 250);
  await page.keyboard.press('KeyP');
  await sleep(100);
  await page.keyboard.press('KeyR');
  s = await state();
  ok &&= s.state === 'paused' && !s.reloading;
  notes.push(`en pausa: recarga ignorada=${!s.reloading}`);
  await page.click('#p-resume');
  record(8, 'Recarga en distintos estados', ok, notes.join('; '));
});

// Bonus weapons: a crate is shot to pick it up; an empty bonus weapon is thrown away.
await safe('B', 'Armas bonus (cajas, cohetes, ametralladora)', async () => {
  const notes = [];
  let ok = true;
  const crate = async (kind) => {
    await page.evaluate((k) => window.__pageHunt.game.pickups.spawn(640, 120, k), kind);
    await sleep(1500); // coming down on its parachute
    const c = await page.evaluate(() => window.__pageHunt.game.pickups.items.map((p) => ({ x: p.x, y: p.y, state: p.state }))[0]);
    // A bullet cuts the parachute: the crate drops and is collected on landing.
    await shoot(c.x, c.y, 120);
    const falling = await page.evaluate(() => window.__pageHunt.game.pickups.items[0]?.state ?? 'collected');
    await sleep(1400);
    notes.push(`caja ${kind.toUpperCase()}: ${c.state} → tras el disparo ${falling}`);
    return c;
  };
  await page.click('#b-restart');
  await page.waitForFunction(() => window.__pageHunt.game.state === 'playing', null, { timeout: 20_000 });
  await crate('rocket');
  let s = await state();
  ok &&= s.weapon === 'rocket' && s.ammo === 6;
  notes.push(`al aterrizar → arma=${s.weapon}, munición=${s.ammo}`);
  // A rocket that hits a duck directly still explodes: the duck next to it falls too.
  await page.evaluate(() => window.__pageHunt.game.flock.frenzy(3));
  await page.waitForFunction(() => window.__pageHunt.game.flock.alive.length >= 2, null, { timeout: 8000 });
  const dPage = (await state()).destruction;
  const pair = await page.evaluate(() => {
    const [a, b] = window.__pageHunt.game.flock.alive;
    for (const [d, x, y] of [[a, 500, 330], [b, 565, 345]]) Object.assign(d, { x, y, vx: 0, vy: 0, turnT: 99 });
    return { x: a.x, y: a.y };
  });
  await shoot(pair.x, pair.y, 150);
  const aoe = await page.evaluate(() => window.__pageHunt.game.flock.ducks.filter((d) => d.x >= 490 && d.x <= 575 && d.state !== 'fly').length);
  const dPage2 = (await state()).destruction;
  ok &&= aoe >= 2 && dPage2 > dPage;
  notes.push(`cohete directo a un pato: patos abatidos en el radio=${aoe}, la explosión dañó la página ${(dPage * 100).toFixed(1)}%→${(dPage2 * 100).toFixed(1)}%`);
  await sleep(400);
  const d0 = s.destruction;
  // Crates dropped by the ducks it just killed could refill the launcher: clear them, then empty it.
  await page.evaluate(() => window.__pageHunt.game.pickups.clear());
  for (let i = 0; i < 12 && (await state()).weapon === 'rocket'; i++) await shoot(300 + (i % 6) * 120, 300, 480);
  s = await state();
  ok &&= s.weapon === 'shotgun' && s.destruction > d0;
  notes.push(`cohetes restantes: destrucción ${(d0 * 100).toFixed(1)}%→${(s.destruction * 100).toFixed(1)}%, arma tras vaciarse=${s.weapon}`);
  // Heart crate: shot down, it gives back a heart.
  await page.evaluate(() => (window.__pageHunt.game.hearts = 2));
  await crate('heart');
  const hearts = await page.evaluate(() => window.__pageHunt.game.hearts);
  ok &&= hearts === 3;
  notes.push(`caja de corazón con 2 corazones → ${hearts}`);
  await page.keyboard.press('KeyR');
  await sleep(1700);
  await crate('hmg');
  s = await state();
  const shots0 = s.shots;
  ok &&= s.weapon === 'hmg';
  const fx = await fxBox();
  await page.mouse.move(fx.x + 640, fx.y + 450);
  await page.mouse.down();
  await sleep(1000);
  await page.mouse.up();
  const s2 = await state();
  const auto = s2.shots - shots0;
  ok &&= auto >= 8;
  notes.push(`ametralladora: ${auto} disparos manteniendo el clic 1 s, munición ${s2.ammo}/60`);
  await page.keyboard.press('KeyR');
  await sleep(100);
  const s3 = await state();
  ok &&= !s3.reloading && s3.weapon === 'hmg';
  notes.push(`R con arma bonus: no recarga (recargando=${s3.reloading})`);
  await shot('0B-bonus');
  record('B', 'Armas bonus (cajas, cohetes, ametralladora)', ok, notes.join('; '));
});

// Bosses: round 5 brings Mamá Pato; beating it gives a heart back and the next round.
await safe('J', 'Jefe y corazones', async () => {
  const notes = [];
  let ok = true;
  await page.click('#b-restart');
  await page.waitForFunction(() => window.__pageHunt.game.state === 'playing', null, { timeout: 20_000 });
  await page.evaluate(() => {
    const g = window.__pageHunt.game;
    g.flock.round = 5;
    g.hearts = 2;
  });
  await page.waitForFunction(() => window.__pageHunt.game.boss, null, { timeout: 5000 });
  const name = await page.evaluate(() => window.__pageHunt.game.boss.name);
  await sleep(1800); // entrance
  const heartsHud = await page.locator('#hearts .heart:not(.empty)').count();
  notes.push(`ronda 5 → jefe "${name}", corazones en el HUD=${heartsHud}`);
  ok &&= name === 'MAMÁ PATO' && heartsHud === 2;
  // Ally crate: shot down, it lands and an ally duck joins the fight.
  await page.evaluate(() => window.__pageHunt.game.pickups.spawn(640, 380, 'ally'));
  await sleep(300);
  const crate = await page.evaluate(() => {
    const c = window.__pageHunt.game.pickups.items.find((p) => p.kind === 'ally');
    return { x: c.x, y: c.y };
  });
  await shoot(crate.x, crate.y, 1300);
  const allies0 = await page.evaluate(() => window.__pageHunt.game.allies.active);
  await sleep(3000);
  const ally = await page.evaluate(() => ({ shots: window.__pageHunt.game.allies.shots, hits: window.__pageHunt.game.allies.hits }));
  notes.push(`caja A → aliados=${allies0}, en 3 s: ${ally.shots} disparos, ${ally.hits} aciertos`);
  ok &&= allies0 === 1 && ally.hits > 0;
  await shot('0J-boss');
  await page.evaluate(() => {
    const g = window.__pageHunt.game;
    g.equip('rocket');
    g.equip('rocket');
  });
  let rockets = 0;
  let heartsBefore = 2;
  while (await page.evaluate(() => window.__pageHunt.game.boss && window.__pageHunt.game.boss.dying === 0)) {
    if (rockets >= 12) break;
    const b = await page.evaluate(() => ({ x: window.__pageHunt.game.boss.x, y: window.__pageHunt.game.boss.y, hearts: window.__pageHunt.game.hearts }));
    heartsBefore = b.hearts; // eggs that reach the ground during the fight cost hearts
    await shoot(b.x, b.y, 480);
    rockets++;
  }
  await sleep(2400);
  const after = await page.evaluate(() => {
    const g = window.__pageHunt.game;
    return { boss: Boolean(g.boss), defeated: g.bossesDefeated, hearts: g.hearts, round: g.flock.round, crates: g.pickups.items.length };
  });
  const pctAfter = await page.locator('#progress-pct').innerText();
  const doneTicks = await page.locator('.boss-tick.done').count();
  ok &&= parseInt(pctAfter, 10) >= 25 && doneTicks === 1;
  notes.push(`avance tras el jefe=${pctAfter}, marcas de jefe en verde=${doneTicks}`);
  const alliesLeft = await page.evaluate(() => window.__pageHunt.game.allies.active);
  ok &&= alliesLeft === 0;
  notes.push(`aliados tras caer el jefe=${alliesLeft}`);
  notes.push(`${rockets} cohetes → jefes derrotados=${after.defeated}, corazones ${heartsBefore}→${after.hearts} (+1 por vencer), ronda=${after.round}, cajas de recompensa=${after.crates}`);
  ok &&= !after.boss && after.defeated === 1 && after.hearts === Math.min(3, heartsBefore + 1) && after.round === 6;
  // Losing every heart ends the game with a defeat screen.
  await page.evaluate(() => {
    const g = window.__pageHunt.game;
    g.hurtPlayer(300, 300);
  });
  await sleep(1600);
  await page.evaluate(() => {
    const g = window.__pageHunt.game;
    g.hurtPlayer(300, 300);
  });
  await sleep(1600);
  await page.evaluate(() => window.__pageHunt.game.hurtPlayer(300, 300));
  await page.waitForSelector('#end:not(.hidden)', { timeout: 5000 });
  const title = await page.locator('#end-title').innerText();
  notes.push(`3 golpes → "${title}"`);
  ok &&= title.includes('DERROTARON');
  await shot('0J-defeat');
  await page.click('#e-restart');
  await page.waitForFunction(() => window.__pageHunt.game.state === 'playing', null, { timeout: 20_000 });
  const fresh = await page.evaluate(() => ({ hearts: window.__pageHunt.game.hearts, round: window.__pageHunt.game.flock.round, hold: window.__pageHunt.game.flock.holdRound }));
  ok &&= fresh.hearts === 3 && fresh.round === 1 && !fresh.hold;
  notes.push(`jugar otra vez → corazones=${fresh.hearts}, ronda=${fresh.round}, rondas bloqueadas=${fresh.hold}`);
  record('J', 'Jefe y corazones', ok, notes.join('; '));
});

// Full game to the end screen on the own page.
await safe('9a', 'Partida completa hasta el estado final', async () => {
  const fx = await fxBox();
  let n = 0;
  const t0 = Date.now();
  while ((await state()).state === 'playing' && n < 500 && Date.now() - t0 < 180_000) {
    const s = await state();
    if (s.ammo === 0) {
      await page.mouse.move(80 + ((n * 97) % (fx.width - 160)), 80 + ((n * 61) % (fx.height - 160)));
      await page.keyboard.press('KeyR');
      await sleep(1250);
    }
    await shoot(40 + ((n * 137) % (fx.width - 80)), 30 + ((n * 89) % (fx.height - 60)), 190);
    if (n % 25 === 24) await page.mouse.wheel(0, n % 200 < 100 ? 300 : -300);
    if (n % 50 === 49) console.log(`      9a: ${n + 1} disparos, destrucción ${(s.destruction * 100).toFixed(1)}%`);
    n++;
  }
  const last = await state();
  if (last.state === 'playing') throw new Error(`no se alcanzó el objetivo: ${n} disparos, destrucción ${(last.destruction * 100).toFixed(1)}%`);
  await page.waitForSelector('#end:not(.hidden)', { timeout: 15_000 });
  const stats = await page.locator('#end-stats').innerText();
  const title = await page.locator('#end-title').innerText();
  await shot('09-end-screen');
  record('9a', 'Partida completa hasta el estado final', true, `${n} disparos; final "${title}": ${stats.replace(/\n/g, ' ')}`);
  await page.click('#e-restart');
  await page.waitForFunction(() => window.__pageHunt.game.state === 'playing', null, { timeout: 20_000 });
  const s = await state();
  record('9b', 'Jugar otra vez desde la pantalla final', s.destruction === 0 && s.points === 0, `estado=${s.state}, destrucción=${s.destruction}, puntos=${s.points}`);
});

// Victory: beating the round-20 boss collapses the page and shows the champion screen.
await safe('9c', 'Victoria tras la ronda 20', async () => {
  await page.evaluate(() => (window.__pageHunt.game.flock.round = 20));
  await page.waitForFunction(() => window.__pageHunt.game.boss?.kind === 'king', null, { timeout: 8000 });
  await sleep(1800); // entrance
  // Finish it off through the rocket blast path (the ghost king teleports too much to chase here).
  await page.evaluate(() => {
    const b = window.__pageHunt.game.boss;
    b.alpha = 1;
    b.blast(b.x, b.y, 100, 10_000);
  });
  await page.waitForFunction(() => document.getElementById('page-layer').classList.contains('collapsing'), null, { timeout: 8000 });
  await page.waitForSelector('#end:not(.hidden)', { timeout: 10_000 });
  const title = await page.locator('#end-title').innerText();
  const pct = await page.locator('#progress-pct').innerText();
  const ticks = await page.locator('.boss-tick.done').count();
  record('9c', 'Victoria tras la ronda 20', title.includes('CAMPEÓN') && pct === '100%', `jefe de la ronda 20 vencido → derrumbe de la página, título "${title}", avance ${pct}, marcas de jefe en verde=${ticks}`);
  await shot('09c-victory');
  await page.click('#e-restart');
  await page.waitForFunction(() => window.__pageHunt.game.state === 'playing', null, { timeout: 20_000 });
});

// 2: external page that allows iframes.
await safe(2, 'Página externa que permite iframe (example.com)', async () => {
  await changeUrl();
  const r = await submitUrl('https://example.com');
  const iframeOk = r.modes.find((m) => m.mode === 'iframe')?.ok;
  const p = await playMode('iframe');
  for (let i = 0; i < 8; i++) await shoot(400 + i * 40, 250 + (i % 3) * 60);
  const s = await state();
  const attrs = await page.evaluate(() => {
    const f = document.querySelector('.page-frame');
    return { sandbox: f.getAttribute('sandbox'), credentialless: f.hasAttribute('credentialless'), referrer: f.referrerPolicy };
  });
  // A sandboxed frame without scripts cannot be inspected from the test either, so check
  // what the game can reach: the frame's URL is loaded and its DOM is not accessible.
  const frameUrl = page.frames().find((f) => f.url().includes('example.com'))?.url() ?? null;
  const domBlocked = await page.evaluate(() => document.querySelector('.page-frame').contentDocument === null);
  await shot('02-iframe-example');
  record(2, 'Página externa que permite iframe (example.com)', iframeOk && p.badge.startsWith('IFRAME') && s.destruction > 0 && frameUrl && domBlocked && attrs.sandbox === '' && attrs.credentialless,
    `iframe permitido=${iframeOk}, insignia="${p.badge}", sandbox="${attrs.sandbox}", credentialless=${attrs.credentialless}, referrer=${attrs.referrer}; frame cargado=${frameUrl}; DOM inaccesible para el juego=${domBlocked}; daño en capa=${(s.destruction * 100).toFixed(1)}%`);
});

// 3: external page that forbids iframes.
await safe(3, 'Página externa que bloquea iframe (github.com)', async () => {
  await changeUrl();
  const r = await submitUrl('https://github.com');
  const iframe = r.modes.find((m) => m.mode === 'iframe');
  const rec = r.modes.find((m) => m.recommended)?.mode;
  const p = await playMode('capture');
  if (p.error) throw new Error(p.error);
  // Two magazines at the same area (the reload no longer does damage by itself).
  for (let i = 0; i < 12; i++) {
    if (i === 6) {
      await page.keyboard.press('KeyR');
      await sleep(1600);
    }
    await shoot(640, 150 + (i % 6) * 30, 340);
  }
  await page.keyboard.press('KeyR');
  // Frame rate while the blast debris falls (headless, software rendering: a lower bound).
  const fps = await page.evaluate(() => new Promise((done) => {
    let n = 0;
    const t0 = performance.now();
    const step = () => (performance.now() - t0 < 1500 ? (n++, requestAnimationFrame(step)) : done(Math.round((n * 1000) / (performance.now() - t0))));
    requestAnimationFrame(step);
  }));
  await sleep(300);
  const s = await state();
  await shot('03-capture-github');
  record('FPS', 'Fotogramas durante la destrucción (simulación visual)', fps >= 30, `${fps} fps medidos 1,5 s tras una onda expansiva`);
  record(3, 'Página externa que bloquea iframe (github.com)', !iframe.ok && rec === 'capture' && p.badge === 'SIMULACIÓN VISUAL' && s.destruction > 0 && s.broken > 0,
    `iframe disponible=${iframe.ok} (${r.compat.match(/Content-Security-Policy[^\n]*|X-Frame-Options[^\n]*/)?.[0] ?? '?'}); recomendado=${rec}; insignia="${p.badge}"; destrucción=${(s.destruction * 100).toFixed(1)}%, piezas rotas=${s.broken}`);

  // 9: restart and change of stage.
  await page.click('#b-restart');
  await page.waitForFunction(() => window.__pageHunt.game.state === 'playing', null, { timeout: 60_000 });
  const a = await state();
  await changeUrl();
  const startVisible = await page.isVisible('#start');
  const hudHidden = await page.isHidden('#hud');
  const g = await page.evaluate(() => ({ stage: Boolean(window.__pageHunt.game.stage), layer: document.getElementById('page-layer').childElementCount }));
  record(9, 'Reinicio y cambio de escenario', a.state === 'playing' && a.destruction === 0 && a.points === 0 && startVisible && hudHidden && !g.stage && g.layer === 0,
    `reinicio: destrucción=${a.destruction}, puntos=${a.points}; cambiar URL: inicio visible=${startVisible}, HUD oculto=${hudHidden}, escenario liberado=${!g.stage && g.layer === 0}`);
});

// 4, 5, 6: URL validation.
await safe(4, 'URL inválida', async () => {
  const cases = ['no es una url', 'https://', 'holamundo', 'https://no-existe-dominio-xyz123.com'];
  const out = [];
  for (const u of cases) {
    const r = await submitUrl(u);
    out.push(`"${u}" → ${r.error ? 'rechazada' : 'ACEPTADA'}: ${r.status}`);
  }
  record(4, 'URL inválida', out.every((o) => o.includes('rechazada')), out.join(' | '));
});
await safe(5, 'URL sin protocolo', async () => {
  const r = await submitUrl('example.com');
  record(5, 'URL sin protocolo', !r.error && r.input === 'https://example.com/' && r.compat?.includes('EXAMPLE.COM'), `"example.com" → campo="${r.input}", aviso="${r.status}"`);
});
await safe(6, 'Esquemas no permitidos y red privada', async () => {
  const cases = ['javascript:alert(1)', 'data:text/html,<h1>x</h1>', 'file:///etc/passwd', 'ftp://example.com', 'http://127.0.0.1:8080', 'http://169.254.169.254/latest/meta-data', 'https://user:pass@example.com'];
  const out = [];
  for (const u of cases) {
    const r = await submitUrl(u);
    out.push(`"${u}" → ${r.error ? 'rechazada' : 'ACEPTADA'}: ${r.status}`);
  }
  record(6, 'Esquemas no permitidos y red privada', out.every((o) => o.includes('rechazada')), out.join(' | '));
});
await safe('D', 'Recurso que no es una página (modo D)', async () => {
  const r = await submitUrl('https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg');
  const none = r.modes.every((m) => !m.ok);
  const offersDemo = await page.isVisible('text=Usar la página de prueba');
  await shot('0D-unsupported');
  record('D', 'Recurso que no es una página (modo D)', none && offersDemo, `ningún modo disponible=${none}; alternativa ofrecida=${offersDemo}; ${r.compat?.split('\n').find((l) => l.includes('no es una página')) ?? ''}`);
});

// 10: screen sizes.
await safe(10, 'Diferentes tamaños de pantalla', async () => {
  const out = [];
  let ok = true;
  for (const [w, h] of [[1920, 1080], [1280, 720], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await changeUrl().catch(() => {});
    if (!(await page.isVisible('#start'))) await page.evaluate(() => document.getElementById('b-url').click());
    await shot(`10-start-${w}x${h}`);
    await submitUrl(`${BASE}/demo/`);
    await playMode('dom');
      const fx = await fxBox();
    for (let i = 0; i < 6; i++) await shoot(fx.width * (0.2 + i * 0.1), fx.height * (0.3 + (i % 3) * 0.12), 360);
    const s = await state();
    const m = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const buttons = [...document.querySelectorAll('.hud-buttons button')].map((b) => b.getBoundingClientRect());
      return {
        hscroll: document.documentElement.scrollWidth > innerWidth,
        buttonsInside: buttons.every((b) => b.right <= innerWidth && b.bottom <= innerHeight && b.width > 0),
        hudH: Math.round(r('hud').height),
        stageH: Math.round(r('stage').height),
        ammoVisible: r('hud-bottom').bottom <= innerHeight,
      };
    });
    const good = !m.hscroll && m.buttonsInside && m.stageH > 300 && m.ammoVisible && s.destruction > 0;
    ok &&= good;
    out.push(`${w}x${h}: ${good ? 'ok' : 'FALLO'} (HUD ${m.hudH}px, escenario ${m.stageH}px, scroll horizontal=${m.hscroll}, daño=${(s.destruction * 100).toFixed(1)}%)`);
    await shot(`10-game-${w}x${h}`);
  }
  record(10, 'Diferentes tamaños de pantalla', ok, out.join(' | '));
});

record('JS', 'Errores de JavaScript inesperados', consoleErrors.length === 0,
  `${consoleErrors.length ? consoleErrors.slice(0, 5).join(' | ') : 'ninguno'} (esperados: ${expectedErrors.length}, de ellos respuestas 400 de la API a URLs rechazadas: ${failedApi.filter((f) => f.includes('/api/')).length}, scripts bloqueados por el sandbox del iframe: ${expectedErrors.filter((e) => e.includes('sandboxed')).length})`);

writeFileSync(new URL('results.json', OUT), JSON.stringify(results, null, 2));
await browser.close();
await server.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones superadas. Capturas en tests/e2e/out/`);
process.exit(failed ? 1 : 0);
