// URL validation shared by the client and the local server.
// User input is untrusted: only http(s) pages, no credentials, no odd hosts.

export type UrlErrorCode = 'empty' | 'scheme' | 'invalid' | 'credentials' | 'host' | 'length';

export type UrlCheck =
  | { ok: true; url: URL; addedProtocol: boolean }
  | { ok: false; code: UrlErrorCode; message: string };

const MAX_LENGTH = 2048;

const fail = (code: UrlErrorCode, message: string): UrlCheck => ({ ok: false, code, message });

/** `host:port` without a scheme, e.g. `localhost:5173/demo` (otherwise it would parse as scheme "localhost:"). */
const HOST_PORT = /^[a-z0-9.-]+:\d{1,5}(?:[/?#]|$)/i;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

export function normalizeUrl(raw: string): UrlCheck {
  const input = raw.trim();
  if (!input) return fail('empty', 'Escribe una dirección, por ejemplo https://example.com');
  if (input.length > MAX_LENGTH) return fail('length', 'La dirección es demasiado larga.');
  // Control characters and inner whitespace are a common trick to smuggle schemes past naive checks.
  if (/[\s\u0000-\u001f\u007f]/.test(input)) return fail('invalid', 'La dirección no puede contener espacios ni caracteres de control.');

  let text = input;
  let addedProtocol = false;
  const scheme = SCHEME.exec(input);
  if (scheme && !HOST_PORT.test(input)) {
    const name = scheme[1].toLowerCase();
    if (name !== 'http' && name !== 'https') {
      return fail('scheme', `El esquema "${name}:" no está permitido. Solo se aceptan páginas http:// o https://.`);
    }
  } else {
    const local = /^(localhost|127\.0\.0\.1)(?::|\/|$)/i.test(input);
    text = `${local ? 'http' : 'https'}://${input.replace(/^\/\//, '')}`;
    addedProtocol = true;
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return fail('invalid', 'No es una dirección válida.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail('scheme', 'Solo se aceptan páginas http:// o https://.');
  }
  if (url.username || url.password) {
    return fail('credentials', 'Las direcciones con usuario o contraseña no están permitidas: el juego nunca usa credenciales.');
  }
  const host = url.hostname;
  const isIpv6 = host.startsWith('[');
  if (!host || (!isIpv6 && host !== 'localhost' && !/^[a-z0-9-]+(\.[a-z0-9-]+)+\.?$/i.test(host))) {
    return fail('host', `"${host || input}" no parece un dominio válido.`);
  }
  url.hash = '';
  return { ok: true, url, addedProtocol };
}
