// GET /api/probe?url=...: reads the response headers of a public page (no cookies,
// no credentials) to tell which game modes it supports.
import { frameVerdict, type FrameVerdict } from '../src/core/frame';
import { checkPublicUrl, isPublicHost, UserError } from './net';

export const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 PageHunt/0.1';

export interface ProbeResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  html: boolean;
  frame: FrameVerdict;
}

export async function probe(raw: string, embedderOrigin: string): Promise<ProbeResult> {
  const start = await checkPublicUrl(raw);
  let url = start;
  let res: Response | null = null;
  for (let hop = 0; hop < 6; hop++) {
    try {
      res = await fetch(url, {
        redirect: 'manual',
        credentials: 'omit',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
        signal: AbortSignal.timeout(9000),
      });
    } catch (e) {
      const cause = (e as { cause?: { code?: string } }).cause?.code;
      throw new UserError('unreachable', `No se pudo conectar con ${url.host}${cause ? ` (${cause})` : ''}.`);
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) break;
    await res.body?.cancel();
    const next = new URL(location, url);
    if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new UserError('scheme', 'La página redirige a un esquema no permitido.');
    if (!(await isPublicHost(next.hostname))) throw new UserError('private', 'La página redirige a una dirección de red privada.');
    url = next;
    res = null;
  }
  if (!res) throw new UserError('redirects', 'La página redirige demasiadas veces.');
  await res.body?.cancel().catch(() => {});

  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return {
    url: start.href,
    finalUrl: url.href,
    status: res.status,
    contentType,
    html: contentType === 'text/html' || contentType === 'application/xhtml+xml' || contentType === '',
    frame: frameVerdict((n) => res!.headers.get(n), embedderOrigin),
  };
}
