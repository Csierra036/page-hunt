// Game loop: input, firing, reloading, ducks, bonus weapons, bosses, hearts, scoring, endings.
import * as audio from './audio';
import { POINTS, progress, Score } from './core/score';
import { Weapon, type BonusId } from './core/weapon';
import { Allies } from './fx/allies';
import { Boss, BOSSES, bossForRound, MAX_ROUND, type BossHost } from './fx/bosses';
import { Flock, type Duck } from './fx/ducks';
import { Particles } from './fx/particles';
import { Pickups, randomBonus, type Pickup } from './fx/pickups';
import { Reticle } from './fx/reticle';
import { keyLabel, saveSettings, type Settings } from './settings';
import { emptyHit, mergeHits, type HitResult, type Stage } from './stage/types';

export type GameState = 'idle' | 'playing' | 'paused' | 'finale' | 'over';

/** Why the game ended: all 20 rounds cleared, or out of hearts. */
export type Ending = 'victory' | 'defeat';

export const MAX_HEARTS = 3;

export interface GameCallbacks {
  pause(): void;
  over(ending: Ending): void;
  toast(msg: string, ms?: number): void;
}

export class Game {
  state: GameState = 'idle';
  stage: Stage | null = null;
  readonly particles = new Particles();
  readonly reticle = new Reticle();
  score = new Score();
  /** The base weapon: the only one that reloads. */
  shotgun = new Weapon('shotgun');
  /** Temporary weapon from a crate; thrown away when empty. */
  bonus: Weapon | null = null;
  readonly flock: Flock;
  readonly pickups = new Pickups();
  /** Ally ducks from "A" crates: only during boss fights. */
  readonly allies: Allies;
  /** Left button held down, for automatic weapons. */
  private trigger = false;
  boss: Boss | null = null;
  bossesDefeated = 0;
  hearts = MAX_HEARTS;
  ending: Ending | null = null;
  /** Seconds of invulnerability after losing a heart. */
  private invuln = 0;
  private hurtFlash = 0;
  /** Last round whose boss was beaten (so it does not come back). */
  private bossDoneRound = 0;
  aim = { x: 0, y: 0, inside: false };
  w = 0;
  h = 0;
  /** Seconds of active play (pauses excluded). */
  time = 0;
  private dpr = 1;
  private ctx: CanvasRenderingContext2D;
  private shake = 0;
  private finaleT = 0;
  private last = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private stageEl: HTMLElement,
    readonly layer: HTMLElement,
    public settings: Settings,
    private ui: GameCallbacks,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.allies = new Allies(
      (r, x, y) => this.bossHit(r, x, y),
      () => audio.allyShot(),
    );
    this.flock = new Flock({
      spawn: () => audio.quack(),
      escaped: (d) => {
        // Ducks from a bonus flock are a free reward: letting them go costs nothing.
        if (d.extra) return;
        this.score.ducksEscaped++;
        this.score.breakCombo();
        audio.escape();
        this.ui.toast('¡SE ESCAPÓ!', 900);
      },
      crashed: (d) => this.duckCrash(d),
      waveEnd: (hits, total) => {
        audio.round();
        if (hits === total) {
          const pts = this.score.add(1000);
          this.ui.toast(`¡RONDA PERFECTA! +${pts}`, 1600);
        } else {
          this.ui.toast(`RONDA ${this.flock.round} · ${hits}/${total} PATOS`, 1400);
        }
      },
    });
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(stageEl);
    this.resize();
    requestAnimationFrame((t) => this.frame(t));
  }

  get weapon() {
    return this.bonus ?? this.shotgun;
  }

  /** Starts a level on an already mounted stage. */
  begin(stage: Stage) {
    this.stage = stage;
    this.score = new Score();
    this.shotgun = new Weapon('shotgun');
    this.bonus = null;
    this.flock.reset();
    this.pickups.clear();
    this.allies.clear();
    this.particles.clear();
    this.boss = null;
    this.bossesDefeated = 0;
    this.bossDoneRound = 0;
    this.hearts = MAX_HEARTS;
    this.ending = null;
    this.invuln = 0;
    this.time = 0;
    this.finaleT = 0;
    this.layer.classList.remove('collapsing');
    stage.resize(this.w, this.h);
    this.state = 'playing';
  }

  end() {
    this.stage?.dispose();
    this.stage = null;
    this.state = 'idle';
    this.layer.classList.remove('collapsing');
    this.layer.replaceChildren();
    this.particles.clear();
    this.pickups.clear();
    this.allies.clear();
    this.flock.reset();
    this.boss = null;
  }

  pause() {
    if (this.state !== 'playing') return;
    this.trigger = false;
    this.state = 'paused';
    this.ui.pause();
  }

  resume() {
    if (this.state === 'paused') this.state = 'playing';
  }

  private resize() {
    const r = this.stageEl.getBoundingClientRect();
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.particles.floor = this.h;
    this.pickups.floor = this.h;
    this.stage?.resize(this.w, this.h);
  }

  // ---------- Input ----------

  private bindInput() {
    const c = this.canvas;
    const local = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      this.aim.x = e.clientX - r.left;
      this.aim.y = e.clientY - r.top;
    };
    // Scrolling by dragging: right/middle mouse button, or a finger that moves before lifting
    // (a finger that lifts without moving is a shot).
    let drag: { id: number; y: number; moved: number; touch: boolean } | null = null;
    const scrollBy = (dy: number) => {
      if (this.state === 'playing' && this.stage?.scrollable) this.stage.scroll(dy);
    };
    c.addEventListener('pointermove', (e) => {
      local(e);
      this.aim.inside = true;
      if (drag && e.pointerId === drag.id) {
        const dy = e.clientY - drag.y;
        drag.y = e.clientY;
        drag.moved += Math.abs(dy);
        if (!drag.touch || drag.moved > 10) scrollBy(-dy);
      }
    });
    c.addEventListener('pointerleave', () => {
      this.aim.inside = false;
      this.trigger = false;
    });
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      audio.init();
      local(e);
      this.aim.inside = true;
      const touch = e.pointerType !== 'mouse';
      if (touch || e.button === 1 || e.button === 2) {
        drag = { id: e.pointerId, y: e.clientY, moved: 0, touch: touch && e.button === 0 };
        c.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button === 0 && (this.state === 'playing' || this.state === 'finale')) {
        this.trigger = true;
        this.fire();
      }
    });
    const endDrag = (e: PointerEvent) => {
      if (e.button === 0) this.trigger = false;
      if (!drag || e.pointerId !== drag.id) return;
      const tap = drag.touch && drag.moved <= 10;
      drag = null;
      if (tap && e.type === 'pointerup' && (this.state === 'playing' || this.state === 'finale')) {
        local(e);
        this.fire();
      }
    };
    c.addEventListener('pointerup', endDrag);
    c.addEventListener('pointercancel', endDrag);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.state === 'playing' && this.stage?.scrollable) this.stage.scroll(e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => this.key(e));
    // Focus moving into the stage iframe is not the player leaving.
    window.addEventListener('blur', () => setTimeout(() => document.activeElement?.tagName !== 'IFRAME' && this.pause()));
    document.addEventListener('visibilitychange', () => document.hidden && this.pause());
  }

  private key(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (document.querySelector('.overlay:not(.hidden)')) return;
    if (this.state !== 'playing' && this.state !== 'finale') return;
    const code = e.code;
    if (code === this.settings.reloadKey) {
      e.preventDefault();
      if (!e.repeat) this.reload();
    } else if (code === 'KeyP' || code === 'Escape') {
      e.preventDefault();
      this.pause();
    } else if (code === 'KeyM') {
      this.toggleMute();
    } else if (code === 'Space' || code === 'Enter') {
      e.preventDefault();
      if (!e.repeat) this.fire();
    } else if (/^(ArrowUp|ArrowDown|PageUp|PageDown)$/.test(code) && this.stage?.scrollable) {
      e.preventDefault();
      const step = code.startsWith('Page') ? this.h * 0.8 : 60;
      this.stage.scroll(code === 'ArrowUp' || code === 'PageUp' ? -step : step);
    }
  }

  toggleMute() {
    this.settings.muted = !this.settings.muted;
    audio.setMuted(this.settings.muted);
    saveSettings(this.settings);
  }

  /** Picks up a bonus weapon (or adds a magazine if it is the one already held). */
  equip(kind: BonusId) {
    if (this.bonus?.def.id === kind) this.bonus.refill();
    else this.bonus = new Weapon(kind);
    audio.pickup();
    this.ui.toast(`¡${this.bonus.def.name.toUpperCase()}! · ${this.bonus.ammo} BALAS`, 1400);
  }

  // ---------- Shooting ----------

  /** Spread scales down a little on small stages. */
  private get spread() {
    return this.weapon.def.spread * Math.max(0.6, Math.min(1, this.w / 1100));
  }

  fire() {
    const stage = this.stage;
    if (!stage) return;
    const wpn = this.weapon;
    if (!wpn.fire(this.time * 1000)) {
      // Holding the trigger of an automatic weapon just waits for the next round.
      if (wpn.def.auto) return;
      if (wpn.reloading || wpn.ammo === 0) audio.dryFire();
      if (!wpn.reloading && wpn.ammo === 0) this.ui.toast(`SIN MUNICIÓN · PULSA ${keyLabel(this.settings.reloadKey)}`, 1000);
      return;
    }
    const def = wpn.def;
    audio.gun(def.id);
    const kick = { shotgun: 1, hmg: 0.25, rocket: 1, sniper: 0.7 }[def.id];
    this.reticle.fire(kick);
    this.addShake(kick * 7);

    let total = emptyHit();
    let duckHit = false;
    for (let i = 0; i < def.pellets; i++) {
      let px = this.aim.x;
      let py = this.aim.y;
      if (def.spread > 0) {
        const a = Math.random() * Math.PI * 2;
        const r = this.spread * Math.sqrt(Math.random());
        px += Math.cos(a) * r;
        py += Math.sin(a) * r;
      }
      // Direct hit, in order: boss (and its projectiles), ducks, crates, the page.
      const b = this.boss?.shoot(px, py, def.damage) ?? null;
      const duck = b ? null : this.flock.hitTest(px, py);
      const crate = b || duck ? null : this.pickups.hitTest(px, py);
      if (b) {
        this.bossHit(b, px, py);
        duckHit = true;
      } else if (duck) {
        this.shootDuck(duck);
        duckHit = true;
      } else if (crate) {
        // The parachute is cut: the crate drops and is collected when it lands.
        this.cutCrate(crate);
        duckHit = true;
      } else {
        const r = stage.hit(px, py, def.damage);
        total = mergeHits(total, r);
        if (r.kind === 'element') {
          this.particles.chips(px, py, r.color, def.id === 'sniper' ? 10 : 4);
          this.particles.sparks(px, py, 3);
        } else if (r.kind === 'surface') {
          this.particles.sparks(px, py, 3, '#e8e8e8');
          this.particles.dust(px, py, 2, 'rgba(160,160,160,0.4)', 2);
        }
      }
      // Rockets explode wherever they hit: a duck, the boss, a crate or the page.
      if (def.blast) total = mergeHits(total, this.explode(px, py, def.blast.radius, def.blast.power));
    }
    const hit = duckHit || total.kind === 'element';
    this.score.registerShot(hit);
    this.award(total, this.aim.x, this.aim.y);
    if (wpn.spent) {
      // Metal Slug style: an empty bonus weapon is thrown away.
      this.bonus = null;
      audio.shell();
      this.ui.toast('ARMA AGOTADA · VUELVES A LA ESCOPETA', 1200);
    } else if (wpn.ammo === 0) {
      this.ui.toast(`¡RECARGA! · ${keyLabel(this.settings.reloadKey)}`, 900);
    }
  }

  private cutCrate(crate: Pickup) {
    this.pickups.cut(crate);
    this.particles.sparks(crate.x, crate.y - 20, 10, '#ffffff');
    audio.impact();
  }

  /** Rocket explosion: area damage on every enemy in range (ducks, boss and its projectiles), crates and the page. */
  private explode(x: number, y: number, radius: number, power: number) {
    const k = Math.max(0.6, Math.min(1, this.w / 1100));
    const r = radius * k;
    audio.explosion();
    this.addShake(14);
    this.particles.ring(x, y, r, 'rgba(255,200,90,0.95)');
    this.particles.ring(x, y, r * 0.55, 'rgba(255,90,40,0.9)');
    this.particles.sparks(x, y, 24, '#ffb020');
    this.particles.dust(x, y, 14, 'rgba(70,60,55,0.55)', r * 0.35);
    for (const d of this.flock.alive) if (Math.hypot(d.x - x, d.y - y) < r + d.r) this.shootDuck(d);
    for (const c of this.pickups.items) if (c.state === 'parachute' && Math.hypot(c.x - x, c.y - y) < r) this.cutCrate(c);
    const b = this.boss?.blast(x, y, r, power * 1.5);
    if (b) this.bossHit(b, x, y);
    return this.stage!.blast(x, y, r, power);
  }

  // ---------- Bosses and hearts ----------

  private bossHit(b: NonNullable<ReturnType<Boss['shoot']>>, x: number, y: number) {
    if (b.what === 'boss') {
      audio.impact();
      const pts = this.score.add(b.damage * 20);
      this.particles.popup(x, y - 20, `+${pts}`, '#ff9a5a', 11);
      this.particles.sparks(x, y, 5, '#ffcc33');
    } else if (b.what === 'projectile' && b.destroyed) {
      audio.crack();
      this.particles.popup(x, y - 16, `+${this.score.add(50)}`, '#ffffff', 10);
    } else if (b.what === 'armor') {
      audio.dryFire();
      this.particles.popup(x, y - 16, '¡BLINDADO!', '#b9c3cc', 9);
    } else if (b.what === 'decoy') {
      audio.escape();
      this.particles.popup(x, y - 16, '¡FALSO!', '#c9b8ff', 11);
    }
  }

  private spawnBoss(round: number) {
    const kind = bossForRound(round)!;
    const game = this;
    const host: BossHost = {
      get w() {
        return game.w;
      },
      get h() {
        return game.h;
      },
      aim: this.aim,
      particles: this.particles,
      hurtPlayer: (x, y) => this.hurtPlayer(x, y),
      frenzy: (n) => this.flock.frenzy(n),
      blastPage: (x, y, r, p) => this.stage && this.award(this.stage.blast(x, y, r, p), x, y),
    };
    this.boss = new Boss(kind, host);
    this.flock.holdRound = true;
    audio.collapse();
    this.addShake(14);
    this.ui.toast(`¡JEFE! ${BOSSES[kind].name}`, 2400);
  }

  private bossDefeated(boss: Boss) {
    this.bossesDefeated++;
    this.bossDoneRound = this.flock.round;
    const pts = this.score.add(BOSSES[boss.kind].points);
    this.particles.popup(boss.x, boss.y, `+${pts}`, '#ffd84d', 22);
    for (let i = 0; i < 4; i++) this.particles.ring(boss.x, boss.y, 80 + i * 70, 'rgba(255,200,90,0.9)');
    audio.fanfare();
    this.addShake(25);
    this.hearts = Math.min(MAX_HEARTS, this.hearts + 1);
    this.boss = null;
    this.allies.dismiss();
    this.flock.holdRound = false;
    if (this.flock.round >= MAX_ROUND) {
      this.celebrate();
      return;
    }
    // Two weapon crates as a reward, and on to the next round.
    this.pickups.spawn(this.w * 0.35, 40, randomBonus());
    this.pickups.spawn(this.w * 0.65, 40, randomBonus());
    this.flock.nextRound();
    this.ui.toast(`¡${boss.name} DERROTADO! +1 ♥`, 2200);
  }

  /** Heart crate collected: +1 heart, or points when already full. */
  private gainHeart(x: number, y: number) {
    audio.pickup();
    if (this.hearts < MAX_HEARTS) {
      this.hearts++;
      this.particles.popup(x, y - 30, '+1 ♥', '#ff5a7a', 16);
      this.ui.toast(`¡VIDA! ${'♥'.repeat(this.hearts)}`, 1200);
    } else {
      const pts = this.score.add(500);
      this.particles.popup(x, y - 30, `VIDA LLENA +${pts}`, '#ff5a7a', 11);
    }
  }

  hurtPlayer(x: number, y: number) {
    if (this.invuln > 0 || this.state !== 'playing') return;
    this.hearts--;
    this.invuln = 1.5;
    this.hurtFlash = 1;
    this.score.breakCombo();
    audio.hurt();
    this.addShake(18);
    this.particles.ring(x, y, 60, 'rgba(255,60,60,0.9)');
    if (this.hearts <= 0) this.finish('defeat');
    else this.ui.toast(`¡AUCH! ${'♥'.repeat(this.hearts)}`, 1000);
  }

  /** Last boss beaten: the page collapses as a celebration, then the victory screen. */
  private celebrate() {
    this.ending = 'victory';
    this.state = 'finale';
    this.finaleT = 0;
    this.trigger = false;
    this.stage?.collapse();
    audio.collapse();
    this.ui.toast('¡CAMPEÓN! ¡LA PÁGINA SE DERRUMBA!', 2400);
  }

  /** 0..1 towards clearing the 20 rounds. */
  get progress() {
    if (this.ending === 'victory') return 1;
    const tally = this.flock.tally;
    const fraction = this.boss
      ? 1 - this.boss.hp / this.boss.max
      : tally.length
        ? tally.filter((t) => t !== 'pending').length / tally.length
        : 0;
    return progress(this.flock.round, fraction);
  }

  /** Ends the game straight away (defeat). */
  private finish(ending: Ending) {
    this.ending = ending;
    this.state = 'over';
    this.trigger = false;
    if (ending === 'defeat') audio.lose();
    this.ui.over(ending);
  }

  private award(res: HitResult, x: number, y: number) {
    let pts = 0;
    if (res.damage > 0) pts += this.score.add(POINTS.damage * res.damage);
    if (res.broke > 0) {
      pts += this.score.add(POINTS.breakBase * res.broke + res.breakPoints);
      this.score.broken += res.broke;
      audio.shatter(res.broke > 2);
    } else if (res.damage > 0) {
      audio.impact();
    }
    if (pts > 0) this.particles.popup(x, y - 26, `+${pts}`, res.broke ? '#ffcc33' : '#ffffff', res.broke ? 16 : 11);
  }

  private shootDuck(d: Duck) {
    this.flock.shoot(d, this.h);
    this.score.ducksHit++;
    audio.duckHit();
    const base = d.kind === 'golden' ? POINTS.goldenDuck : d.kind === 'bonus' ? POINTS.bonusDuck : POINTS.duck;
    const pts = this.score.add(base);
    this.particles.popup(d.x, d.y - d.r * 1.6, `+${pts}`, d.kind === 'normal' ? '#ffffff' : '#ffd84d', 16);
    this.particles.chips(d.x, d.y, d.palette.body, 10);
    this.particles.chips(d.x, d.y, '#ffffff', 6);
    if (d.kind === 'bonus') {
      this.flock.frenzy(6);
      audio.round();
      this.ui.toast('¡BANDADA BONUS!', 1400);
    }
    // Weapon drops: always from golden ducks, often from the rest.
    // During a boss fight ducks drop weapons more often: they are the player's support.
    const chance = d.kind === 'golden' ? 1 : d.kind === 'bonus' ? 0.5 : (d.extra ? 0.15 : 0.3) * (this.boss ? 1.6 : 1);
    // Hearts are rare; otherwise a weapon. Ally crates ("A") only exist while a boss is on screen.
    const heartChance = d.kind === 'golden' ? 0.12 : d.kind === 'bonus' ? 0.06 : d.extra ? 0.02 : 0.03;
    if (Math.random() < heartChance) this.pickups.spawn(d.x, d.y, 'heart');
    else if (Math.random() < chance) this.pickups.spawn(d.x, d.y, this.boss && Math.random() < 0.4 ? 'ally' : randomBonus());
  }

  /** A shot duck crashes into the page. */
  private duckCrash(d: Duck) {
    if (!this.stage || this.state === 'over') return;
    audio.thud();
    this.addShake(6);
    this.particles.dust(d.x, d.y, 10, 'rgba(160,140,110,0.5)', 14);
    this.particles.ring(d.x, d.y, 70, 'rgba(255,200,120,0.7)');
    this.award(this.stage.blast(d.x, d.y, 80 + d.r * 2, d.golden ? 8 : 4), d.x, d.y);
  }

  // ---------- Reload ----------

  reload() {
    if (!this.stage || (this.state !== 'playing' && this.state !== 'finale')) return;
    audio.init();
    if (this.bonus) {
      this.ui.toast(`${this.bonus.def.name.toUpperCase()}: NO SE RECARGA`, 900);
      return;
    }
    const wpn = this.weapon;
    if (wpn.reloading) {
      const r = wpn.tryActive();
      if (r === 'perfect') {
        audio.stopReload();
        audio.perfect();
        const pts = this.score.add(POINTS.perfectReload);
        this.particles.popup(this.aim.x, this.aim.y - 50, `¡RECARGA PERFECTA! +${pts}`, '#45d483', 13);
      } else if (r === 'jam') {
        audio.jam();
        this.ui.toast('¡ENCASQUILLADA!', 900);
      }
      return;
    }
    if (!wpn.startReload()) {
      this.ui.toast('CARGADOR LLENO', 700);
      return;
    }
    audio.pump(wpn.def.reloadTime / 1000);
  }

  private addShake(n: number) {
    if (this.settings.shake) this.shake = Math.min(30, this.shake + n);
  }

  // ---------- Loop ----------

  private frame(t: number) {
    const dt = Math.min(0.05, (t - (this.last || t)) / 1000);
    this.last = t;
    if (this.stage && (this.state === 'playing' || this.state === 'finale' || this.state === 'over')) this.update(dt);
    this.draw();
    requestAnimationFrame((n) => this.frame(n));
  }

  private update(dt: number) {
    const stage = this.stage!;
    if (this.state !== 'over') this.time += dt;
    if (this.shotgun.update(dt * 1000)) audio.reloadDone();
    if (this.trigger && this.weapon.def.auto && (this.state === 'playing' || this.state === 'finale')) this.fire();
    for (const crate of this.pickups.update(dt)) {
      this.particles.sparks(crate.x, crate.y, 14, '#ffffff');
      if (crate.kind === 'heart') this.gainHeart(crate.x, crate.y);
      else if (crate.kind !== 'ally') this.equip(crate.kind);
      else if (this.boss) {
        this.allies.spawn(this.w, this.h);
        audio.pickup();
        this.ui.toast('¡PATO ALIADO!', 1200);
      }
    }
    this.allies.update(dt, this.boss, this.w, this.h);
    this.reticle.update(dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    if (this.state === 'playing') {
      if (!this.boss && bossForRound(this.flock.round) && this.bossDoneRound < this.flock.round) this.spawnBoss(this.flock.round);
      if (this.boss) {
        this.boss.update(dt);
        if (this.boss.dead) this.bossDefeated(this.boss);
      }
    }
    this.flock.update(dt, this.w, this.h, this.state === 'playing');
    stage.update(dt);
    this.particles.update(dt);

    this.shake *= Math.exp(-dt * 9);
    const s = this.shake > 0.3 ? this.shake : 0;
    this.stageEl.style.transform = s ? `translate(${(Math.random() - 0.5) * s}px, ${(Math.random() - 0.5) * s}px)` : '';

    if (this.state === 'finale') {
      this.finaleT += dt;
      if (this.finaleT > 1 && !this.layer.classList.contains('collapsing')) this.layer.classList.add('collapsing');
      if (this.finaleT > 3.4) {
        this.state = 'over';
        audio.fanfare();
        this.ui.over('victory');
      }
    }
  }

  /** Boss name and a segmented pixel health bar at the top of the stage. */
  private drawBossBar(ctx: CanvasRenderingContext2D, b: Boss) {
    const bw = Math.min(420, this.w - 40);
    const x = Math.round((this.w - bw) / 2);
    // Below the toast area, which announces the boss.
    const y = 66;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - 6, y - 6, bw + 12, 38);
    ctx.font = '9px "Press Start 2P", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = b.enraged ? '#ff5a5a' : '#ffffff';
    ctx.fillText(`${b.name}${b.enraged ? ' · ¡FURIOSO!' : ''}`, x, y);
    const segs = 20;
    const sw = (bw - (segs - 1) * 2) / segs;
    const filled = Math.ceil((b.hp / b.max) * segs);
    for (let i = 0; i < segs; i++) {
      ctx.fillStyle = i < filled ? (b.enraged ? '#ff3b3b' : '#ffcc33') : '#2a2a3a';
      ctx.fillRect(Math.round(x + i * (sw + 2)), y + 14, Math.floor(sw), 10);
    }
  }

  private draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.stage) return;
    this.flock.draw(ctx);
    this.boss?.draw(ctx);
    this.allies.draw(ctx);
    this.pickups.draw(ctx);
    this.particles.draw(ctx);
    if (this.boss && this.boss.dying === 0) this.drawBossBar(ctx, this.boss);
    if (this.hurtFlash > 0) {
      ctx.fillStyle = `rgba(255,30,30,${(this.hurtFlash * 0.35).toFixed(3)})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (this.state === 'playing' || this.state === 'finale' || this.state === 'paused') {
      if (this.aim.inside) {
        this.reticle.draw(ctx, Math.round(this.aim.x), Math.round(this.aim.y), this.spread, this.weapon, keyLabel(this.settings.reloadKey), performance.now() / 1000);
      }
    }
  }
}
