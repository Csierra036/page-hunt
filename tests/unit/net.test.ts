import { describe, expect, it } from 'vitest';
import { checkPublicUrl, isPrivateIp } from '../../server/net';

describe('SSRF guard', () => {
  it('flags private, loopback, link-local and special ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:192.168.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['93.184.215.14', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it('rejects local URLs before any request', async () => {
    await expect(checkPublicUrl('http://127.0.0.1:22')).rejects.toThrow(/privad|local/);
    await expect(checkPublicUrl('http://localhost:5173/')).rejects.toThrow(/privad|local/);
    await expect(checkPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/privad|local/);
    await expect(checkPublicUrl('javascript:alert(1)')).rejects.toThrow(/esquema/);
  });
});
