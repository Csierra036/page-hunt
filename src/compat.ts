// Decides how a URL can become a level, from the browser's real restrictions:
//  - same origin as the game          -> DOM real (B)
//  - external, headers allow framing  -> live iframe with a damage overlay (A), or capture (C)
//  - external, framing forbidden      -> capture / visual simulation (C)
//  - nothing works                    -> unsupported, with the reason (D)
import type { Capture } from '../server/capture';
import { normalizeUrl } from './core/url';
import type { StageMode } from './stage/types';

export interface ModeOption {
  mode: StageMode;
  available: boolean;
  reason: string;
}

export interface Compat {
  url: string;
  host: string;
  sameOrigin: boolean;
  options: ModeOption[];
  recommended: StageMode | null;
  /** Shown when no mode is available. */
  problem: string | null;
}

interface ProbeResponse {
  finalUrl: string;
  status: number;
  contentType: string;
  html: boolean;
  frame: { embeddable: boolean; reason: string };
  captureAvailable: boolean;
  error?: string;
}

export class CompatError extends Error {}

async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new CompatError('No hay conexión con el servidor local del juego (¿está corriendo `npm run dev`?).');
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new CompatError('El servidor local del juego no respondió (usa `npm run dev` o `npm run preview`).');
  if (!res.ok || data.error) throw new CompatError(data.error ?? `Error ${res.status}`);
  return data as T;
}

export async function checkCompat(raw: string, signal?: AbortSignal): Promise<Compat> {
  const parsed = normalizeUrl(raw);
  if (!parsed.ok) throw new CompatError(parsed.message);
  const url = parsed.url;

  if (url.origin === location.origin) {
    return {
      url: url.href,
      host: url.host,
      sameOrigin: true,
      options: [
        { mode: 'dom', available: true, reason: 'Es una página de este mismo servidor: se puede modificar su DOM real.' },
        { mode: 'iframe', available: false, reason: 'Innecesario: el modo DOM real ya muestra la página en vivo.' },
        { mode: 'capture', available: false, reason: 'Innecesario para páginas propias.' },
      ],
      recommended: 'dom',
      problem: null,
    };
  }

  const probe = await api<ProbeResponse>(`/api/probe?url=${encodeURIComponent(url.href)}`, signal);
  const dom: ModeOption = {
    mode: 'dom',
    available: false,
    reason: 'Pertenece a otro origen: el navegador no permite que esta web lea ni modifique su DOM.',
  };
  if (!probe.html) {
    return {
      url: url.href,
      host: url.host,
      sameOrigin: false,
      options: [dom, { mode: 'iframe', available: false, reason: 'No es una página HTML.' }, { mode: 'capture', available: false, reason: 'No es una página HTML.' }],
      recommended: null,
      problem: `La dirección no es una página web sino "${probe.contentType}". Prueba con la portada del sitio o con la página de prueba.`,
    };
  }
  const httpError = probe.status >= 400;
  const iframe: ModeOption = httpError
    ? { mode: 'iframe', available: false, reason: `El sitio respondió con el código ${probe.status}.` }
    : {
        mode: 'iframe',
        available: probe.frame.embeddable,
        reason: probe.frame.embeddable ? `${probe.frame.reason} Sin desplazamiento: el navegador no deja seguir el scroll de otra web.` : probe.frame.reason,
      };
  const capture: ModeOption = !probe.captureAvailable
    ? { mode: 'capture', available: false, reason: 'El servidor local no tiene Chromium para hacer capturas (define CHROMIUM_PATH).' }
    : httpError
      ? { mode: 'capture', available: false, reason: `El sitio respondió con el código ${probe.status}: no hay página que capturar.` }
      : { mode: 'capture', available: true, reason: 'Se captura una imagen de la página (sin cookies) y se destruye la imagen. Se puede desplazar.' };

  // Capture gives per-element destruction, so it is the better game when available.
  const recommended = capture.available ? 'capture' : iframe.available ? 'iframe' : null;
  return {
    url: probe.finalUrl || url.href,
    host: new URL(probe.finalUrl || url.href).host,
    sameOrigin: false,
    options: [dom, iframe, capture],
    recommended,
    problem: recommended ? null : `No se puede usar esta página: ${[iframe.reason, capture.reason].join(' ')}`,
  };
}

export function fetchCapture(url: string, width: number, signal?: AbortSignal) {
  return api<Capture>(`/api/capture?url=${encodeURIComponent(url)}&w=${Math.round(width)}`, signal);
}

export const MODE_NAMES: Record<StageMode, string> = {
  dom: 'DOM real',
  iframe: 'Iframe en vivo',
  capture: 'Simulación visual',
};
