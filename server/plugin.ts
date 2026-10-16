// Vite dev/preview middleware exposing the local game API.
// It listens on the same local server as the game; URLs never go to third-party services.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { capture, chromiumPath, type Capture } from './capture';
import { UserError } from './net';
import { probe } from './probe';

const captures = new Map<string, Capture>();
const CACHE_SIZE = 12;

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function fail(res: ServerResponse, e: unknown) {
  if (e instanceof UserError) return send(res, 400, { error: e.message, code: e.code });
  console.error('[page-hunt]', e);
  send(res, 500, { error: 'Error interno del servidor del juego.', code: 'internal' });
}

function params(req: IncomingMessage) {
  return new URL(req.url ?? '', 'http://local').searchParams;
}

function embedderOrigin(req: IncomingMessage) {
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim();
  return `${proto}://${req.headers.host ?? 'localhost'}`;
}

export function pageHuntApi(): Plugin {
  const mount = (server: { middlewares: { use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => void } }) => {
    server.middlewares.use('/api/health', (_req, res) => send(res, 200, { capture: Boolean(chromiumPath()) }));

    server.middlewares.use('/api/probe', async (req, res) => {
      try {
        const result = await probe(params(req).get('url') ?? '', embedderOrigin(req));
        send(res, 200, { ...result, captureAvailable: Boolean(chromiumPath()) });
      } catch (e) {
        fail(res, e);
      }
    });

    server.middlewares.use('/api/capture', async (req, res) => {
      try {
        const p = params(req);
        const raw = p.get('url') ?? '';
        const width = Math.round(Math.min(1600, Math.max(360, Number(p.get('w')) || 1280)) / 40) * 40;
        const key = `${width} ${raw}`;
        let cap = captures.get(key);
        if (!cap) {
          cap = await capture(raw, width);
          captures.set(key, cap);
          if (captures.size > CACHE_SIZE) captures.delete(captures.keys().next().value!);
        }
        send(res, 200, cap);
      } catch (e) {
        fail(res, e);
      }
    });
  };
  return {
    name: 'page-hunt-api',
    configureServer: mount,
    configurePreviewServer: mount,
  };
}
