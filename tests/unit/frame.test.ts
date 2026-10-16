import { describe, expect, it } from 'vitest';
import { frameVerdict } from '../../src/core/frame';

const ORIGIN = 'http://localhost:5173';
const verdict = (headers: Record<string, string>) => frameVerdict((n) => headers[n] ?? null, ORIGIN);

describe('frameVerdict', () => {
  it('allows pages without restrictions', () => {
    expect(verdict({}).embeddable).toBe(true);
  });

  it('blocks X-Frame-Options DENY and SAMEORIGIN', () => {
    expect(verdict({ 'x-frame-options': 'DENY' }).embeddable).toBe(false);
    expect(verdict({ 'x-frame-options': 'sameorigin' }).embeddable).toBe(false);
  });

  it('applies CSP frame-ancestors over X-Frame-Options', () => {
    expect(verdict({ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" }).embeddable).toBe(false);
    expect(verdict({ 'content-security-policy': "frame-ancestors 'self' https://*.example.com" }).embeddable).toBe(false);
    expect(verdict({ 'content-security-policy': 'frame-ancestors *', 'x-frame-options': 'DENY' }).embeddable).toBe(true);
    expect(verdict({ 'content-security-policy': 'frame-ancestors http://localhost:5173' }).embeddable).toBe(true);
  });

  it('ignores CSP without frame-ancestors', () => {
    expect(verdict({ 'content-security-policy': "script-src 'self'" }).embeddable).toBe(true);
  });
});
