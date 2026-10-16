// Guards for server-side requests to user-supplied URLs (SSRF): only public
// http(s) hosts, checked again on every redirect and every sub-request.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { normalizeUrl } from '../src/core/url';

export class UserError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function privateV4(ip: string) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

export function isPrivateIp(ip: string) {
  const v = isIP(ip);
  if (v === 4) return privateV4(ip);
  if (v !== 6) return true;
  const s = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return privateV4(mapped[1]);
  return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith('64:ff9b:');
}

const dnsCache = new Map<string, Promise<boolean>>();

/** True when the host resolves only to public addresses. */
export function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return Promise.resolve(!isPrivateIp(host));
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return Promise.resolve(false);
  let p = dnsCache.get(host);
  if (!p) {
    p = lookup(host, { all: true })
      .then((addrs) => addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address)))
      .catch(() => false);
    dnsCache.set(host, p);
    setTimeout(() => dnsCache.delete(host), 60_000);
  }
  return p;
}

/** Validates user input and checks that it points to a public host. */
export async function checkPublicUrl(raw: string): Promise<URL> {
  const res = normalizeUrl(raw);
  if (!res.ok) throw new UserError(res.code, res.message);
  const { hostname } = res.url;
  const host = hostname.replace(/^\[|\]$/g, '');
  if (!isIP(host)) {
    const resolves = await lookup(host).then(() => true, () => false);
    if (!resolves) throw new UserError('dns', `No se encuentra el dominio "${hostname}". Revisa la dirección.`);
  }
  if (!(await isPublicHost(hostname))) {
    throw new UserError('private', 'Las direcciones de red local o privadas no se pueden visitar desde el servidor del juego.');
  }
  return res.url;
}
