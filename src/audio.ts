// WebAudio SFX: recorded samples for the shotgun shot and reload (src/assets/sfx),
// synthesized sounds for everything else and as a fallback while the samples load
// or if they fail. Synth adapted from hotshot-destroy/src/audio.ts.
import reloadUrl from './assets/sfx/reload-shotgun.mp3?url';
import shotUrl from './assets/sfx/shotgun.mp3?url';

interface Sample {
  buffer: AudioBuffer;
  /** Seconds of leading silence to skip so the sound starts on the click. */
  start: number;
}

const samples: { shot: Sample | null; reload: Sample | null } = { shot: null, reload: null };
let reloadSource: AudioBufferSourceNode | null = null;

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
let volume = 0.6;

/** Must be called from a user gesture (browsers block autoplay). */
export function init() {
  if (!ac) {
    try {
      ac = new AudioContext();
    } catch {
      return;
    }
    master = ac.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    loadSample(shotUrl).then((x) => (samples.shot = x));
    loadSample(reloadUrl).then((x) => (samples.reload = x));
  }
  if (ac.state === 'suspended') ac.resume();
}

async function loadSample(url: string): Promise<Sample | null> {
  try {
    const res = await fetch(url);
    const buffer = await ac!.decodeAudioData(await res.arrayBuffer());
    const data = buffer.getChannelData(0);
    let i = 0;
    while (i < data.length && Math.abs(data[i]) < 0.02) i++;
    return { buffer, start: i < data.length ? Math.max(0, i - 64) / buffer.sampleRate : 0 };
  } catch {
    return null; // Keep the synthesized fallback.
  }
}

function play(sample: Sample, vol: number, rate = 1) {
  if (!ac || !master) return null;
  const src = ac.createBufferSource();
  src.buffer = sample.buffer;
  src.playbackRate.value = rate;
  const g = ac.createGain();
  g.gain.value = vol;
  src.connect(g).connect(master);
  src.start(0, sample.start);
  return src;
}

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = muted ? 0 : volume;
}

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (master && !muted) master.gain.value = volume;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number) {
  if (!ac || !master) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, cutoff: number, delay = 0, type: BiquadFilterType = 'lowpass', endCutoff = 120) {
  if (!ac || !master || !noiseBuf) return;
  const t = ac.currentTime + delay;
  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(cutoff, t);
  f.frequency.exponentialRampToValueAtTime(endCutoff, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

export function shotgun() {
  if (samples.shot) {
    play(samples.shot, 0.9, 0.97 + Math.random() * 0.06);
    return;
  }
  noise(0.35, 0.9, 4500, 0, 'lowpass', 200);
  tone(120, 0.25, 'sine', 0.5, 0, 40);
  noise(0.08, 0.4, 9000, 0, 'highpass', 3000);
}

/** Sniper: the shotgun recording, faster: a sharper crack. */
function sniper() {
  if (samples.shot) {
    play(samples.shot, 0.7, 1.45);
    return;
  }
  noise(0.18, 0.7, 7000, 0, 'lowpass', 400);
  tone(220, 0.1, 'square', 0.12, 0, 80);
}

/** Machine gun: short, quiet, very fast cut of the recording. */
function hmg() {
  if (samples.shot) {
    play(samples.shot, 0.3, 2.2 + Math.random() * 0.2);
    return;
  }
  noise(0.06, 0.35, 5000, 0, 'lowpass', 600);
}

function rocket() {
  noise(0.4, 0.35, 1800, 0, 'bandpass', 400);
  tone(300, 0.3, 'sawtooth', 0.06, 0, 120);
}

export function gun(id: 'shotgun' | 'hmg' | 'rocket' | 'sniper') {
  ({ shotgun, hmg, rocket, sniper })[id]();
}

export function explosion() {
  tone(70, 0.7, 'sine', 0.6, 0, 28);
  noise(0.8, 0.8, 1400, 0, 'lowpass', 50);
  noise(0.2, 0.4, 6000, 0, 'highpass', 1200);
}

/** Weapon crate picked up. */
export function pickup() {
  [0, 4, 7, 12].forEach((n, i) => tone(523 * Math.pow(2, n / 12), 0.08, 'square', 0.07, i * 0.04));
}

export function dryFire() {
  tone(1800, 0.02, 'square', 0.08);
  tone(900, 0.03, 'square', 0.05, 0.03);
}

/** Reload start: the recorded shotgun reload stretched to last `seconds`, or a synthesized "chk-chk". */
export function pump(seconds: number) {
  if (samples.reload) {
    stopReload();
    const length = samples.reload.buffer.duration - samples.reload.start;
    reloadSource = play(samples.reload, 0.9, Math.max(0.8, Math.min(1.6, length / seconds)));
    return;
  }
  noise(0.06, 0.35, 2500, 0, 'bandpass', 1800);
  tone(300, 0.04, 'square', 0.08);
  noise(0.07, 0.4, 2200, 0.16, 'bandpass', 1500);
  tone(240, 0.05, 'square', 0.08, 0.16);
}

export function shell(delay = 0) {
  tone(1400, 0.03, 'triangle', 0.06, delay);
  noise(0.03, 0.15, 3000, delay, 'highpass', 2000);
}

export function reloadDone() {
  if (samples.reload) return; // The recording already ends with the pump.
  tone(500, 0.05, 'square', 0.07);
  tone(750, 0.08, 'square', 0.07, 0.06);
}

/** Cuts the reload recording short (perfect active reload). */
export function stopReload() {
  try {
    reloadSource?.stop();
  } catch {
    // Already finished.
  }
  reloadSource = null;
}

export function perfect() {
  [0, 7, 12].forEach((n, i) => tone(660 * Math.pow(2, n / 12), 0.12, 'square', 0.07, i * 0.05));
}

export function jam() {
  tone(140, 0.25, 'sawtooth', 0.12, 0, 90);
  noise(0.15, 0.3, 800, 0.05);
}

export function impact() {
  noise(0.05, 0.25, 3500, 0, 'bandpass', 1200);
}

export function crack() {
  noise(0.08, 0.3, 5000, 0, 'highpass', 1500);
}

export function shatter(big = false) {
  noise(big ? 0.6 : 0.3, big ? 0.6 : 0.4, 8000, 0, 'highpass', 600);
  tone(big ? 70 : 140, big ? 0.4 : 0.15, 'square', 0.08, 0, big ? 35 : 60);
  for (let i = 0; i < 4; i++) tone(2000 + Math.random() * 3000, 0.04, 'triangle', 0.03, 0.05 + Math.random() * 0.2);
}

export function quack() {
  if (!ac || !master) return;
  tone(520, 0.09, 'sawtooth', 0.06, 0, 380);
  tone(480, 0.12, 'sawtooth', 0.06, 0.12, 330);
}

export function duckHit() {
  tone(880, 0.06, 'square', 0.08);
  tone(440, 0.5, 'triangle', 0.07, 0.08, 110);
}

export function thud() {
  tone(80, 0.25, 'sine', 0.5, 0, 40);
  noise(0.2, 0.4, 900);
}

export function escape() {
  tone(300, 0.12, 'square', 0.05);
  tone(250, 0.12, 'square', 0.05, 0.13);
  tone(200, 0.25, 'square', 0.05, 0.26);
}

export function round() {
  [0, 4, 7, 12, 7, 12].forEach((n, i) => tone(392 * Math.pow(2, n / 12), 0.12, 'square', 0.06, i * 0.09));
}

export function collapse() {
  noise(2.5, 0.8, 1500, 0, 'lowpass', 40);
  tone(60, 2.2, 'sine', 0.6, 0, 25);
  for (let i = 0; i < 10; i++) noise(0.25, 0.4, 6000, Math.random() * 1.8, 'highpass', 800);
}

export function fanfare() {
  const melody = [0, 4, 7, 12, 7, 12, 16];
  const lens = [1, 1, 1, 2, 1, 1, 3];
  let t = 0;
  melody.forEach((n, i) => {
    tone(392 * Math.pow(2, n / 12), lens[i] * 0.13, 'square', 0.06, t);
    tone(196 * Math.pow(2, n / 12), lens[i] * 0.13, 'triangle', 0.05, t);
    t += lens[i] * 0.13;
  });
}

/** The player lost a heart. */
export function hurt() {
  tone(220, 0.25, 'square', 0.12, 0, 80);
  noise(0.2, 0.4, 2000, 0, 'lowpass', 200);
}

/** Out of hearts. */
export function lose() {
  [7, 4, 0, -5].forEach((n, i) => tone(392 * Math.pow(2, n / 12), 0.22, 'square', 0.07, i * 0.2));
}

/** An ally duck fires. */
export function allyShot() {
  tone(1200, 0.05, 'square', 0.04, 0, 600);
}
