// HUD rendering (DOM): only touches the elements whose values changed.
import { MAX_HEARTS, type Game } from './game';
import { BOSS_ORDER, MAX_ROUND } from './fx/bosses';
import { keyLabel } from './settings';

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** 7x6 pixel heart. */
const heart = (full: boolean) =>
  `<svg viewBox="0 0 7 6" class="heart${full ? '' : ' empty'}"><path d="M1 0h2v1h1V0h2v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z"/></svg>`;

export const SOUND_ON = '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10l-4-3H2zM11 5l1-1a6 6 0 0 1 0 8l-1-1a4.5 4.5 0 0 0 0-6z"/></svg>';
export const SOUND_OFF = '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10l-4-3H2zM11 6l1-1 1.5 1.5L15 5l1 1-1.5 1.5L16 9l-1 1-1.5-1.5L12 10l-1-1 1.5-1.5z"/></svg>';

export class Hud {
  private last = new Map<string, string>();
  private toastTimer = 0;

  constructor() {
    // A mark where each boss round starts (rounds 5, 10, 15, 20).
    $('boss-ticks').innerHTML = BOSS_ORDER.map((_, i) => `<i class="boss-tick" style="left:${(((i + 1) * 5 - 1) / MAX_ROUND) * 100}%"></i>`).join('');
  }

  private set(id: string, prop: 'text' | 'html' | 'width' | 'class', value: string) {
    const key = `${id}:${prop}`;
    if (this.last.get(key) === value) return;
    this.last.set(key, value);
    const el = $(id);
    if (prop === 'text') el.textContent = value;
    else if (prop === 'html') el.innerHTML = value;
    else if (prop === 'width') el.style.width = value;
    else el.className = value;
  }

  reset() {
    this.last.clear();
  }

  update(g: Game) {
    const stage = g.stage;
    if (!stage) return;
    const pct = Math.floor(g.progress * 100);
    this.set('progress-pct', 'text', `${pct}%`);
    this.set('progress-bar', 'width', `${pct}%`);
    $('boss-ticks').querySelectorAll('.boss-tick').forEach((t, i) => t.classList.toggle('done', i < g.bossesDefeated));
    this.set('score', 'text', g.score.points.toLocaleString('es'));
    this.set('combo', 'text', `x${g.score.multiplier}`);
    this.set('combo', 'class', g.score.multiplier > 1 ? 'hot' : '');
    this.set('round', 'text', `${g.flock.round}/${MAX_ROUND}`);
    this.set('hearts', 'html', Array.from({ length: MAX_HEARTS }, (_, i) => heart(i < g.hearts)).join(''));
    this.set('b-sound', 'html', g.settings.muted ? SOUND_OFF : SOUND_ON);

    const wpn = g.weapon;
    this.set('weapon-name', 'text', wpn.def.name.toUpperCase());
    this.set('ammo-count', 'text', `${wpn.ammo}/${wpn.def.mag}`);
    this.set(
      'shells',
      'html',
      wpn.def.bonus ? `<b class="bonus-ammo">${wpn.def.letter} × ${wpn.ammo}</b>` : Array.from({ length: wpn.def.mag }, (_, i) => `<i class="shell${i < wpn.ammo ? '' : ' spent'}"></i>`).join(''),
    );
    this.set('reload', 'class', `reload${wpn.reloading ? '' : ' idle'}`);
    this.set('reload-fill', 'width', `${Math.round(wpn.progress * 100)}%`);
    this.set('reload-fill', 'class', wpn.jammed ? 'jam' : '');
    const [a, b] = wpn.def.sweet;
    const sweet = $('reload-sweet');
    sweet.style.left = `${a * 100}%`;
    sweet.style.width = `${(b - a) * 100}%`;
    sweet.style.display = wpn.reloading && !wpn.activeTried ? '' : 'none';
    const key = keyLabel(g.settings.reloadKey);
    const hint = wpn.def.bonus
      ? 'Arma bonus: sin recarga'
      : wpn.reloading
      ? wpn.jammed
        ? '¡Encasquillada!'
        : wpn.activeTried
          ? 'Recargando…'
          : `Pulsa ${key} en la zona verde`
      : wpn.ammo === 0
        ? `¡Sin munición! Pulsa ${key}`
        : `${key}: recargar`;
    this.set('reload-hint', 'text', hint);
    this.set('reload-hint', 'class', `hint${wpn.ammo === 0 && !wpn.reloading ? ' warn' : ''}`);
    this.set('tally', 'html', g.flock.tally.map((t) => `<i class="tally ${t}"></i>`).join(''));
  }

  toast(msg: string, ms = 1200) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
  }
}

export function show(...ids: string[]) {
  ids.forEach((id) => $(id).classList.remove('hidden'));
}

export function hide(...ids: string[]) {
  ids.forEach((id) => $(id).classList.add('hidden'));
}
