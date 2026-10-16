import { describe, expect, it } from 'vitest';
import { normalizeUrl } from '../../src/core/url';

const ok = (raw: string) => {
  const r = normalizeUrl(raw);
  if (!r.ok) throw new Error(`expected ok for ${raw}: ${r.message}`);
  return r;
};
const code = (raw: string) => {
  const r = normalizeUrl(raw);
  return r.ok ? 'ok' : r.code;
};

describe('normalizeUrl', () => {
  it('accepts http and https', () => {
    expect(ok('https://example.com').url.href).toBe('https://example.com/');
    expect(ok('http://example.com/a?b=1').url.href).toBe('http://example.com/a?b=1');
  });

  it('adds https:// when the protocol is missing', () => {
    const r = ok('example.com/page');
    expect(r.addedProtocol).toBe(true);
    expect(r.url.href).toBe('https://example.com/page');
    expect(ok('www.wikipedia.org').url.protocol).toBe('https:');
  });

  it('uses http for localhost with a port and no scheme', () => {
    expect(ok('localhost:5173/demo/').url.href).toBe('http://localhost:5173/demo/');
  });

  it('rejects dangerous or non-web schemes', () => {
    for (const raw of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'ftp://example.com', 'vbscript:msgbox', 'blob:https://x/y', 'about:blank', 'chrome://settings']) {
      expect(code(raw), raw).toBe('scheme');
    }
  });

  it('rejects smuggled whitespace and control characters', () => {
    expect(code('java\tscript:alert(1)')).toBe('invalid');
    expect(code('https://exa mple.com')).toBe('invalid');
  });

  it('rejects invalid input', () => {
    expect(code('')).toBe('empty');
    expect(code('   ')).toBe('empty');
    expect(code('no es una url')).toBe('invalid');
    expect(code('https://')).toBe('invalid');
    expect(code('holamundo')).toBe('host');
    expect(code('https://exa_mple..com')).toBe('host');
    expect(code(`https://example.com/${'a'.repeat(3000)}`)).toBe('length');
  });

  it('rejects URLs with credentials', () => {
    expect(code('https://user:pass@example.com')).toBe('credentials');
  });

  it('drops the fragment', () => {
    expect(ok('https://example.com/a#top').url.href).toBe('https://example.com/a');
  });
});
