// Mode B: a page served by this same origin (the developer's own pages, e.g. /demo/).
// The game has access to its real DOM, so damage changes the actual elements:
// progressive filters, pixel chips bitten off its edges (clip-path), whole-pixel
// displacement, and finally a stepped fall out of the page.
import { crackPaths, damageStage, distToRect, EdgeBites, falloff, gridShatter, hpForArea, hpForImage, type Poly } from '../core/damage';
import { pixelCracks, pixelHole } from '../fx/pixel';
import { emptyHit, mergeHits, readableColor, type HitResult, type Stage, type StageHost } from './types';

interface ElInfo {
  hp: number;
  max: number;
  weight: number;
  /** Counted in the destruction meter (leaf-ish content: text, media, controls). */
  candidate: boolean;
  stage: number;
  broken: boolean;
  bites: EdgeBites | null;
}

interface Decal {
  /** Anchor element, or null for the document itself. */
  el: Element | null;
  /** Element: position as a fraction of its box. Document: document coordinates. */
  rx: number;
  ry: number;
  cracks: Poly[] | null;
}

const MEDIA = /^(IMG|SVG|VIDEO|CANVAS|PICTURE|BUTTON|INPUT|SELECT|TEXTAREA|IFRAME|PROGRESS|METER|HR)$/;
const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|BR|HEAD|META|LINK|TITLE|SOURCE|TRACK|WBR|OPTION)$/;
const MAX_DECALS = 450;

// Pixel-style damage: no smooth rotation or skew, transitions in steps.
const DAMAGE_CSS = `
html, body, * { cursor: none !important; }
[data-ph-inline] { display: inline-block !important; }
[data-ph-dmg] { transition: filter .2s steps(2), transform .2s steps(2); image-rendering: pixelated; }
[data-ph-dmg="1"] { filter: contrast(1.1) saturate(.8); }
[data-ph-dmg="2"] { filter: sepia(.35) saturate(1.6) hue-rotate(-12deg) contrast(1.2);
  transform: translate(var(--ph-dx, 0px), var(--ph-dy, 0px)); }
[data-ph-dmg="3"] { filter: sepia(.75) saturate(2.4) hue-rotate(-28deg) brightness(.72) contrast(1.4);
  transform: translate(calc(var(--ph-dx, 0px) * 2), calc(var(--ph-dy, 0px) * 2)); }
[data-ph-broken] { transition: transform .9s steps(9), opacity .9s steps(4) !important;
  transform: translate(var(--ph-fx, 0px), 110vh) !important;
  opacity: 0 !important; pointer-events: none !important; }
`;

function holeSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  pixelHole(c.getContext('2d')!, 12, 12, 4);
  return c;
}

export class DomStage implements Stage {
  readonly mode = 'dom' as const;
  readonly label = 'DOM REAL';
  readonly detail = 'Página del mismo origen: los disparos modifican sus elementos reales (estilos, posición y visibilidad).';
  readonly scrollable = true;

  private iframe!: HTMLIFrameElement;
  private doc!: Document;
  private win!: Window;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private host!: StageHost;
  private info = new Map<Element, ElInfo>();
  private total = 0;
  private dealt = 0;
  private decals: Decal[] = [];
  private sprites = [holeSprite(), holeSprite(), holeSprite()];
  private w = 0;
  private h = 0;
  private dpr = 1;
  private observer: MutationObserver | null = null;
  private timers: number[] = [];
  private collapseQueue: Element[] | null = null;
  private collapseT = 0;

  constructor(private url: string) {}

  async mount(layer: HTMLElement, host: StageHost) {
    this.host = host;
    const iframe = document.createElement('iframe');
    iframe.className = 'page-frame';
    // Same-origin page owned by the developer: scripts may run, but it cannot navigate the game or open popups.
    iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
    iframe.title = 'Escenario: página propia del mismo origen';
    iframe.src = this.url;
    this.iframe = iframe;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'page-overlay';
    this.ctx = this.canvas.getContext('2d')!;
    layer.append(iframe, this.canvas);

    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error('La página tardó demasiado en cargar.')), 15_000);
      iframe.addEventListener('load', () => (clearTimeout(t), resolve()), { once: true });
    });
    let doc: Document | null = null;
    try {
      doc = iframe.contentDocument;
    } catch {
      doc = null;
    }
    if (!doc?.body || !iframe.contentWindow) {
      throw new Error('Tras cargar, la página ya no es del mismo origen (¿redirección?): su DOM no es accesible.');
    }
    this.doc = doc;
    this.win = iframe.contentWindow;
    const style = doc.createElement('style');
    style.dataset.pageHunt = '';
    style.textContent = DAMAGE_CSS;
    doc.head.append(style);
    this.scan(doc.body);
    // Dynamic content: new elements join the level as they appear.
    let pending: number | null = null;
    const added: Element[] = [];
    this.observer = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach((n) => n.nodeType === 1 && added.push(n as Element));
      if (pending === null && added.length) {
        pending = window.setTimeout(() => {
          pending = null;
          added.splice(0).forEach((el) => el.isConnected && this.scan(el, true));
        }, 200);
      }
    });
    this.observer.observe(doc.body, { childList: true, subtree: true });
    if (this.total === 0) throw new Error('La página no tiene elementos visibles que destruir.');
  }

  private isCandidate(el: Element) {
    const tag = el.tagName.toUpperCase();
    if (SKIP.test(tag)) return false;
    const svg = el.closest('svg');
    if (svg && svg !== el) return false;
    const cs = this.win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.width * r.height < 120) return false;
    if (MEDIA.test(tag)) return true;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent?.trim()) return true;
    // Painted boxes (cards, banners, illustrations) count too, unless they are basically the page background.
    const painted = readableColor(cs.backgroundColor, '') !== '' || cs.backgroundImage !== 'none';
    const vw = this.win.innerWidth;
    const vh = this.win.innerHeight;
    return painted && r.width * r.height < vw * vh * 0.45 && r.width < vw * 0.98;
  }

  /** Pictures and elements painted with a background image get the tougher image hit points. */
  private isImage(el: Element) {
    return /^(IMG|SVG|VIDEO|CANVAS|PICTURE)$/.test(el.tagName.toUpperCase()) || this.win.getComputedStyle(el).backgroundImage !== 'none';
  }

  private scan(root: Element, includeRoot = false) {
    const els = [...(includeRoot ? [root] : []), ...root.querySelectorAll('*')];
    for (const el of els) {
      if (this.info.has(el) || !this.isCandidate(el)) continue;
      const r = el.getBoundingClientRect();
      const weight = Math.sqrt(r.width * r.height);
      const hp = this.isImage(el) ? hpForImage(r.width, r.height) : hpForArea(r.width, r.height);
      this.info.set(el, { hp, max: hp, weight, candidate: true, stage: 0, broken: false, bites: null });
      this.total += weight;
    }
  }

  /** Element under a stage point, or null for the page background. */
  private pick(x: number, y: number): Element | null {
    let el = this.doc.elementFromPoint(x, y);
    if (!el || el === this.doc.documentElement || el === this.doc.body) return null;
    const svg = el.closest('svg');
    if (svg) el = svg;
    if (this.info.has(el)) return el;
    // A container (card, section...): breakable unless it is basically the whole page.
    const r = el.getBoundingClientRect();
    if (r.width * r.height > this.w * this.h * 0.45) return null;
    const hp = Math.min(this.isImage(el) ? 120 : 30, (this.isImage(el) ? hpForImage(r.width, r.height) : hpForArea(r.width, r.height)) + 4);
    this.info.set(el, { hp, max: hp, weight: Math.sqrt(r.width * r.height), candidate: false, stage: 0, broken: false, bites: null });
    return el;
  }

  private colorOf(el: Element) {
    const cs = this.win.getComputedStyle(el);
    return readableColor(cs.backgroundColor, readableColor(cs.color));
  }

  private addDecal(d: Decal) {
    this.decals.push(d);
    if (this.decals.length > MAX_DECALS) this.decals.shift();
  }

  hit(x: number, y: number, damage: number): HitResult {
    const el = this.pick(x, y);
    if (!el) {
      this.addDecal({ el: null, rx: x + this.win.scrollX, ry: y + this.win.scrollY, cracks: Math.random() < 0.3 ? crackPaths(26) : null });
      return { ...emptyHit(), kind: 'surface', color: readableColor(this.win.getComputedStyle(this.doc.body).backgroundColor, '#ddd') };
    }
    return this.damage(el, damage, x, y, false);
  }

  private damage(el: Element, amount: number, x: number, y: number, blast: boolean): HitResult {
    const info = this.info.get(el);
    if (!info || info.broken) return emptyHit();
    const before = info.hp;
    info.hp = Math.max(0, info.hp - amount);
    const dealt = before - info.hp;
    if (info.candidate) this.dealt += (info.weight * dealt) / info.max;
    const r = el.getBoundingClientRect();
    const color = this.colorOf(el);
    const rx = r.width ? (x - r.left) / r.width : 0.5;
    const ry = r.height ? (y - r.top) / r.height : 0.5;
    if (!blast) this.addDecal({ el, rx, ry, cracks: null });

    const style = (el as HTMLElement).style;
    const stage = damageStage(info.hp, info.max);
    if (stage !== info.stage && stage < 4) {
      if (info.stage === 0) {
        // Knocked out of place by whole pixels.
        style.setProperty('--ph-dx', `${(Math.random() < 0.5 ? -1 : 1) * 2}px`);
        style.setProperty('--ph-dy', `${Math.random() < 0.5 ? 2 : 0}px`);
        if (this.win.getComputedStyle(el).display === 'inline') el.setAttribute('data-ph-inline', '');
      }
      info.stage = stage;
      el.setAttribute('data-ph-dmg', String(stage));
      if (stage >= 2) this.addDecal({ el, rx, ry, cracks: crackPaths(Math.max(14, Math.min(110, Math.min(r.width, r.height) * 0.7))) });
    }
    // From cracked on, hits chip pixel blocks off the nearest edge of the real element.
    if (info.stage >= 2 && info.hp > 0 && r.width >= 10 && r.height >= 8) {
      const w = (el as HTMLElement).offsetWidth || r.width;
      const h = (el as HTMLElement).offsetHeight || r.height;
      if (!info.bites || Math.abs(info.bites.w - w) > 2 || Math.abs(info.bites.h - h) > 2) info.bites = new EdgeBites(w, h);
      info.bites.bite(rx * w, ry * h, info.stage >= 3 ? 3 : 2);
      style.setProperty('clip-path', `polygon(${info.bites.polygon().map(([px, py]) => `${px}px ${py}px`).join(',')})`);
      this.host.particles.chips(x, y, color, 4);
    }
    if (info.hp <= 0) {
      const b = this.breakEl(el, x, y);
      return { kind: 'element', damage: dealt, broke: b.count, breakPoints: b.points, color };
    }
    const k = blast ? 6 : 3;
    el.animate?.(
      [{ translate: '0 0' }, { translate: `${(Math.random() - 0.5) * k * 2}px ${(Math.random() - 0.5) * k * 2}px` }, { translate: '0 0' }],
      { duration: 160, easing: 'steps(2)' },
    );
    return { kind: 'element', damage: dealt, broke: 0, breakPoints: 0, color };
  }

  private markBroken(info: ElInfo) {
    if (info.broken) return false;
    if (info.candidate) this.dealt += (info.weight * info.hp) / info.max;
    info.hp = 0;
    info.broken = true;
    return true;
  }

  private breakEl(el: Element, x: number, y: number) {
    const info = this.info.get(el)!;
    let count = 0;
    let points = 0;
    if (this.markBroken(info)) {
      count++;
      points += Math.round(info.weight / 2);
    }
    // Everything inside falls with it.
    for (const [child, ci] of this.info) {
      if (child !== el && el.contains(child) && this.markBroken(ci)) {
        count++;
        points += Math.round(ci.weight / 4);
      }
    }
    const r = el.getBoundingClientRect();
    const style = (el as HTMLElement).style;
    style.setProperty('--ph-fx', `${Math.round((Math.random() - 0.5) * 60) * 4}px`);
    if (this.win.getComputedStyle(el).display === 'inline') el.setAttribute('data-ph-inline', '');
    el.setAttribute('data-ph-broken', '');

    // Fragments of the visible part of the element.
    const x0 = Math.max(0, r.left);
    const y0 = Math.max(0, r.top);
    const vw = Math.min(this.w, r.right) - x0;
    const vh = Math.min(this.h, r.bottom) - y0;
    if (vw > 2 && vh > 2) {
      const cs = this.win.getComputedStyle(el);
      const painted = readableColor(cs.backgroundColor, '') !== '' || cs.backgroundImage !== 'none' || MEDIA.test(el.tagName.toUpperCase());
      if (painted) {
        const n = Math.max(4, Math.min(36, Math.round((vw * vh) / 40 ** 2)));
        this.host.particles.shatterRect(x0, y0, gridShatter(vw, vh, n), this.colorOf(el), null, 1, x, y);
      } else {
        // Bare text: it crumbles into small chips of its colour instead of big solid shards.
        const color = readableColor(cs.color);
        for (let i = 0, n = Math.min(30, Math.round((vw * vh) / 400) + 6); i < n; i++) {
          this.host.particles.chips(x0 + Math.random() * vw, y0 + Math.random() * vh, color, 1);
        }
      }
      this.host.particles.dust(x0 + vw / 2, y0 + vh / 2, 8, 'rgba(200,190,170,0.45)', Math.min(vw, vh) / 3);
    }
    this.timers.push(window.setTimeout(() => style.setProperty('visibility', 'hidden', 'important'), 1150));
    this.decals = this.decals.filter((d) => !d.el || !el.contains(d.el));
    return { count, points };
  }

  blast(x: number, y: number, radius: number, power: number): HitResult {
    let res = emptyHit();
    for (const [el, info] of this.info) {
      if (info.broken) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > this.h || r.right < 0 || r.left > this.w) continue;
      const f = falloff(distToRect(x, y, r.left, r.top, r.width, r.height), radius);
      if (f < 0.05) continue;
      // Cracked elements with little life left shake loose and fall (big images do not).
      const amount = info.stage >= 3 && f > 0.3 && info.hp <= 6 ? info.hp : power * f;
      res = mergeHits(res, this.damage(el, amount, r.left + r.width / 2, r.top + r.height / 2, true));
    }
    return res;
  }

  scroll(dy: number) {
    this.win.scrollBy(0, dy);
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  update(dt: number) {
    if (this.collapseQueue) {
      this.collapseT += dt;
      const n = Math.ceil(this.collapseQueue.length * dt * 1.5) + 1;
      for (const el of this.collapseQueue.splice(0, n)) {
        if (this.info.get(el)?.broken) continue;
        const r = el.getBoundingClientRect();
        this.breakEl(el, r.left + r.width / 2, r.top + r.height / 2);
      }
      if (!this.collapseQueue.length) this.collapseQueue = null;
    }

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const rects = new Map<Element, DOMRect>();
    const sx = this.win.scrollX;
    const sy = this.win.scrollY;
    this.decals.forEach((d, i) => {
      let x: number;
      let y: number;
      let r: DOMRect | undefined;
      if (d.el) {
        r = rects.get(d.el);
        if (!r) rects.set(d.el, (r = d.el.getBoundingClientRect()));
        x = r.left + d.rx * r.width;
        y = r.top + d.ry * r.height;
      } else {
        x = d.rx - sx;
        y = d.ry - sy;
      }
      if (y < -120 || y > this.h + 120) return;
      if (d.cracks) {
        ctx.save();
        if (r) {
          ctx.beginPath();
          ctx.rect(r.left, r.top, r.width, r.height);
          ctx.clip();
        }
        pixelCracks(ctx, d.cracks, x, y);
        ctx.restore();
      } else {
        ctx.drawImage(this.sprites[i % 3], Math.round(x) - 12, Math.round(y) - 12);
      }
    });
  }

  destruction() {
    return this.total ? Math.min(1, this.dealt / this.total) : 0;
  }

  collapse() {
    this.collapseQueue = [...this.info.entries()]
      .filter(([, i]) => !i.broken)
      .map(([el]) => [el, el.getBoundingClientRect().bottom] as const)
      .sort((a, b) => b[1] - a[1])
      .map(([el]) => el);
  }

  dispose() {
    this.observer?.disconnect();
    this.timers.forEach(clearTimeout);
    this.iframe?.remove();
    this.canvas?.remove();
  }
}
