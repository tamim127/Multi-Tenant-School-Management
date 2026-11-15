import { describe, expect, it } from 'vitest';
import { hashPassword, tokenHash, verifyPassword } from '../src/password';
describe('password and session primitives', () => {
  it('salts passwords and verifies correct and wrong input', async () => {
    const a = await hashPassword('Synthetic-Only-2026!');
    const b = await hashPassword('Synthetic-Only-2026!');
    expect(a).not.toBe(b);
    expect(await verifyPassword('Synthetic-Only-2026!', a)).toBe(true);
    expect(await verifyPassword('incorrect', a)).toBe(false);
    expect(await verifyPassword('anything', 'broken')).toBe(false);
  });
  it('hashes bearer tokens deterministically without storing plaintext', () => {
    expect(tokenHash('token')).toHaveLength(64);
    expect(tokenHash('token')).toBe(tokenHash('token'));
    expect(tokenHash('token')).not.toBe(tokenHash('other'));
  });
});
