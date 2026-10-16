// Decides whether a response may be shown inside an iframe of `embedderOrigin`,
// following what browsers enforce: CSP frame-ancestors wins over X-Frame-Options.
// This only reads the site's policy; the game never tries to get around it.

export interface FrameVerdict {
  embeddable: boolean;
  reason: string;
}

type HeaderGetter = (name: string) => string | null;

function sourceMatches(source: string, origin: URL) {
  const s = source.toLowerCase();
  if (s === '*') return true;
  if (s === "'none'" || s === "'self'") return false;
  if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return s === origin.protocol;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : `${origin.protocol}//${s}`;
    const u = new URL(withScheme.replace('*.', 'wildcard.'));
    const hostOk = s.includes('*.')
      ? origin.hostname.endsWith(u.hostname.replace(/^wildcard/, ''))
      : u.hostname === origin.hostname;
    const portOk = !u.port || u.port === origin.port;
    return hostOk && portOk && u.protocol === origin.protocol;
  } catch {
    return false;
  }
}

export function frameVerdict(get: HeaderGetter, embedderOrigin: string): FrameVerdict {
  const origin = new URL(embedderOrigin);
  // Several CSP headers arrive comma-joined; every policy must allow framing.
  const csp = get('content-security-policy');
  if (csp) {
    for (const policy of csp.split(',')) {
      const directive = policy
        .split(';')
        .map((d) => d.trim())
        .find((d) => /^frame-ancestors(\s|$)/i.test(d));
      if (!directive) continue;
      const sources = directive.split(/\s+/).slice(1);
      if (!sources.some((s) => sourceMatches(s, origin))) {
        return { embeddable: false, reason: `La página declara "Content-Security-Policy: ${directive}", que impide mostrarla dentro de otra web.` };
      }
    }
    if (/frame-ancestors/i.test(csp)) return { embeddable: true, reason: 'Su política frame-ancestors permite mostrarla en un iframe.' };
  }
  const xfo = get('x-frame-options')?.split(',')[0].trim().toUpperCase();
  if (xfo === 'DENY' || xfo === 'SAMEORIGIN') {
    return { embeddable: false, reason: `La página envía "X-Frame-Options: ${xfo}", que prohíbe mostrarla dentro de otra web.` };
  }
  return { embeddable: true, reason: 'No declara restricciones para mostrarse en un iframe.' };
}
