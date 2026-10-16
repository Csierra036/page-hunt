// Screens and flow: start (URL + compatibility), loading, play, pause, settings, end.
import './style.css';
import * as audio from './audio';
import { checkCompat, fetchCapture, MODE_NAMES, type Compat } from './compat';
import type { Capture } from '../server/capture';
import { normalizeUrl } from './core/url';
import { Game, type Ending } from './game';
import { keyLabel, loadSettings, RESERVED_KEYS, saveSettings } from './settings';
import { CaptureStage, loadImage } from './stage/capture';
import { DomStage } from './stage/dom';
import { IframeStage } from './stage/iframe';
import type { Stage, StageMode } from './stage/types';
import { $, hide, Hud, show } from './ui';

const settings = loadSettings();
audio.setMuted(settings.muted);
audio.setVolume(settings.volume);

const hud = new Hud();
const game = new Game($<HTMLCanvasElement>('fx'), $('stage'), $('page-layer'), settings, {
  pause: () => show('pause'),
  over: showEnd,
  toast: (m, ms) => hud.toast(m, ms),
});

interface CachedCapture {
  key: string;
  data: Capture;
  full: HTMLImageElement;
  bg: HTMLImageElement;
}

let current: { compat: Compat; mode: StageMode } | null = null;
let cachedCapture: CachedCapture | null = null;
let pending: AbortController | null = null;

const input = $<HTMLInputElement>('url');
const status = $('url-status');
const compatBox = $('compat');

function setStatus(text: string, kind: '' | 'error' | 'busy' = '') {
  status.textContent = text;
  status.className = `status${kind ? ` ${kind}` : ''}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

// ---------- Start screen ----------

async function analyze(raw: string) {
  pending?.abort();
  const ctrl = new AbortController();
  pending = ctrl;
  compatBox.classList.add('hidden');
  const parsed = normalizeUrl(raw);
  if (!parsed.ok) {
    setStatus(parsed.message, 'error');
    return;
  }
  if (parsed.addedProtocol) input.value = parsed.url.href;
  setStatus(`Comprobando ${parsed.url.host}…`, 'busy');
  try {
    const compat = await checkCompat(parsed.url.href, ctrl.signal);
    if (ctrl.signal.aborted) return;
    setStatus(parsed.addedProtocol ? `No indicaste protocolo: se usa ${parsed.url.protocol}//` : '');
    renderCompat(compat);
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    setStatus((e as Error).message, 'error');
    renderUnsupported((e as Error).message);
  }
}

function renderCompat(c: Compat) {
  compatBox.replaceChildren(el('h3', '', `COMPATIBILIDAD DE ${c.host.toUpperCase()}`));
  const order: StageMode[] = c.recommended ? [c.recommended, ...c.options.map((o) => o.mode).filter((m) => m !== c.recommended)] : c.options.map((o) => o.mode);
  for (const mode of order) {
    const opt = c.options.find((o) => o.mode === mode)!;
    const row = el('div', `mode-row ${opt.available ? 'ok' : 'no'}`);
    row.dataset.mode = mode;
    const text = el('div');
    const name = el('b', '', MODE_NAMES[mode]);
    text.append(name);
    if (mode === c.recommended) name.append(el('span', 'tag', 'RECOMENDADO'));
    text.append(el('div', '', opt.reason));
    row.append(el('span', 'mark', opt.available ? '✓' : '✗'), text);
    if (opt.available) {
      const b = el('button', `btn small${mode === c.recommended ? ' primary' : ''}`, 'JUGAR');
      b.type = 'button';
      b.addEventListener('click', () => play(c, mode));
      row.append(b);
    } else {
      row.append(el('span'));
    }
    compatBox.append(row);
  }
  if (c.problem) appendProblem(c.problem);
  compatBox.classList.remove('hidden');
  compatBox.querySelector<HTMLButtonElement>('.btn.primary')?.focus();
}

function appendProblem(text: string) {
  compatBox.append(el('p', 'problem', text));
  const b = el('button', 'btn small', 'Usar la página de prueba');
  b.type = 'button';
  b.addEventListener('click', () => {
    input.value = new URL('/demo/', location.href).href;
    analyze(input.value);
  });
  compatBox.append(b);
}

function renderUnsupported(reason: string) {
  compatBox.replaceChildren(el('h3', '', 'PÁGINA NO COMPATIBLE'));
  appendProblem(`${reason} Puedes probar otra dirección o la página de prueba incluida.`);
  compatBox.classList.remove('hidden');
}

async function buildStage(c: Compat, mode: StageMode, signal: AbortSignal): Promise<Stage> {
  if (mode === 'dom') return new DomStage(c.url);
  if (mode === 'iframe') return new IframeStage(c.url);
  const width = Math.min(1600, Math.max(360, $('stage').clientWidth));
  const key = `${Math.round(width / 40) * 40} ${c.url}`;
  if (cachedCapture?.key !== key) {
    const data = await fetchCapture(c.url, width, signal);
    if (data.blocks.length < 6) throw new Error('La captura casi no tiene elementos que romper.');
    const [full, bg] = await Promise.all([loadImage(data.full), loadImage(data.bg)]);
    cachedCapture = { key, data, full, bg };
  }
  return new CaptureStage(cachedCapture.data, cachedCapture.full, cachedCapture.bg);
}

async function play(c: Compat, mode: StageMode) {
  audio.init();
  pending?.abort();
  const ctrl = new AbortController();
  pending = ctrl;
  show('start');
  hide('pause', 'end', 'settings');
  $('start').classList.add('busy-form');
  setStatus(mode === 'capture' ? 'Capturando la página en el servidor local (puede tardar unos segundos)…' : 'Cargando la página…', 'busy');
  game.end();
  // The HUD must be in place before mounting so the stage has its final size.
  show('hud', 'hud-bottom');
  try {
    const stage = await buildStage(c, mode, ctrl.signal);
    await stage.mount(game.layer, game);
    if (ctrl.signal.aborted) {
      stage.dispose();
      return;
    }
    game.begin(stage);
    current = { compat: c, mode };
    hud.reset();
    const badge = $('mode-badge');
    badge.textContent = stage.label;
    badge.className = `badge ${mode}`;
    badge.title = stage.detail;
    $('site').textContent = c.host;
    $('help-reload').textContent = keyLabel(settings.reloadKey);
    hide('start');
    setStatus('');
    hud.toast(stage.scrollable ? `${stage.label} · RUEDA O CLIC DERECHO + ARRASTRAR PARA DESPLAZAR` : stage.label, 2600);
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    game.end();
    hide('hud', 'hud-bottom');
    setStatus(`No se pudo cargar el escenario: ${(e as Error).message}`, 'error');
    renderUnsupported((e as Error).message);
  } finally {
    $('start').classList.remove('busy-form');
  }
}

function restart() {
  if (current) play(current.compat, current.mode);
}

function changeUrl() {
  pending?.abort();
  game.end();
  current = null;
  hide('hud', 'hud-bottom', 'pause', 'end', 'settings');
  show('start');
  setStatus('');
  input.focus();
  input.select();
}

$('url-form').addEventListener('submit', (e) => {
  e.preventDefault();
  audio.init();
  analyze(input.value);
});
document.querySelectorAll<HTMLButtonElement>('[data-url]').forEach((b) =>
  b.addEventListener('click', () => {
    input.value = new URL(b.dataset.url!, location.href).href;
    analyze(input.value);
  }),
);

// ---------- HUD buttons ----------

const hudButton = (id: string, fn: () => void) =>
  $(id).addEventListener('click', (e) => {
    (e.currentTarget as HTMLElement).blur();
    fn();
  });
hudButton('b-sound', () => game.toggleMute());
hudButton('b-pause', () => game.pause());
hudButton('b-restart', restart);
hudButton('b-url', changeUrl);
hudButton('b-settings', openSettings);
hudButton('b-reload', () => game.reload());
hudButton('mode-badge', () => game.stage && hud.toast(game.stage.detail, 4500));

// ---------- Pause ----------

const resume = () => {
  hide('pause');
  game.resume();
};
$('p-resume').addEventListener('click', resume);
$('p-restart').addEventListener('click', restart);
$('p-url').addEventListener('click', changeUrl);
$('p-settings').addEventListener('click', openSettings);

// ---------- Settings ----------

let listening = false;
const keyBtn = $('s-key');
const syncSettings = () => {
  keyBtn.textContent = keyLabel(settings.reloadKey);
  $<HTMLInputElement>('s-volume').value = String(settings.volume);
  $<HTMLInputElement>('s-sound').checked = !settings.muted;
  $<HTMLInputElement>('s-shake').checked = settings.shake;
  $('help-reload').textContent = keyLabel(settings.reloadKey);
};

function openSettings() {
  game.pause();
  hide('pause');
  syncSettings();
  $('s-msg').textContent = '';
  show('settings');
}

keyBtn.addEventListener('click', () => {
  listening = true;
  keyBtn.textContent = '…';
  keyBtn.classList.add('listening');
  $('s-msg').textContent = 'Pulsa la nueva tecla de recarga (Esc para cancelar)';
});
window.addEventListener(
  'keydown',
  (e) => {
    if (listening) {
      e.preventDefault();
      e.stopPropagation();
      listening = false;
      keyBtn.classList.remove('listening');
      const msg = $('s-msg');
      if (e.code === 'Escape') {
        msg.textContent = '';
      } else if (RESERVED_KEYS.includes(e.code) || e.code === 'Space' || e.code === 'Enter' || e.code.startsWith('Arrow')) {
        msg.textContent = `${keyLabel(e.code)} ya se usa para otra acción.`;
      } else {
        settings.reloadKey = e.code;
        saveSettings(settings);
        msg.textContent = `Recarga asignada a ${keyLabel(e.code)}.`;
      }
      syncSettings();
      return;
    }
    if (!$('pause').classList.contains('hidden') && (e.code === 'Escape' || e.code === 'KeyP')) {
      e.preventDefault();
      resume();
    }
  },
  { capture: true },
);
$('s-volume').addEventListener('input', (e) => {
  settings.volume = Number((e.target as HTMLInputElement).value);
  audio.setVolume(settings.volume);
  saveSettings(settings);
});
$('s-sound').addEventListener('change', (e) => {
  settings.muted = !(e.target as HTMLInputElement).checked;
  audio.setMuted(settings.muted);
  saveSettings(settings);
});
$('s-shake').addEventListener('change', (e) => {
  settings.shake = (e.target as HTMLInputElement).checked;
  saveSettings(settings);
});
$('s-close').addEventListener('click', () => {
  hide('settings');
  if (game.state === 'paused') show('pause');
});

// ---------- End ----------

const ENDINGS: Record<Ending, string> = {
  victory: '¡CAMPEÓN! LAS 20 RONDAS SUPERADAS',
  defeat: '¡TE DERROTARON!',
};

function showEnd(ending: Ending) {
  const s = game.score;
  const stage = game.stage!;
  const t = Math.round(game.time);
  $('end-title').textContent = ENDINGS[ending];
  const rows: [string, string][] = [
    ['Avance', `${Math.floor(game.progress * 100)}%`],
    ['Jefes derrotados', `${game.bossesDefeated}/4`],
    ['Precisión', `${Math.round(s.accuracy * 100)}% (${s.shotsHit}/${s.shots})`],
    ['Mejor combo', String(s.bestCombo)],
    ['Elementos rotos', String(s.broken)],
    ['Patos cazados', `${s.ducksHit} (escapados: ${s.ducksEscaped})`],
    ['Ronda', `${game.flock.round}/20`],
    ['Tiempo', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`],
  ];
  const box = $('end-stats');
  box.replaceChildren(el('div', 'big', `${s.points.toLocaleString('es')} PTS`));
  for (const [k, v] of rows) box.append(el('div', 'k', k), el('div', 'v', v));
  $('end-mode').textContent =
    stage.mode === 'dom'
      ? `${stage.label} · ${current?.compat.host}: se modificaron sus elementos reales (solo en esta pestaña).`
      : `${stage.label} · ${current?.compat.host}: la página real no ha sido modificada.`;
  show('end');
}
$('e-restart').addEventListener('click', restart);
$('e-url').addEventListener('click', changeUrl);

// ---------- HUD refresh ----------

const tick = () => {
  if (game.stage) hud.update(game);
  requestAnimationFrame(tick);
};
tick();
syncSettings();
input.focus();

if (import.meta.env.DEV) {
  // Read-only access for the e2e tests in tests/e2e.
  (window as unknown as { __pageHunt: unknown }).__pageHunt = { game, settings };
}
