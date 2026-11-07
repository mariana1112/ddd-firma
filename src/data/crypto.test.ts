import { describe, expect, it } from 'vitest';
import {
  createDataKey,
  CryptoError,
  decryptFields,
  decryptFile,
  encryptFields,
  encryptFile,
  INVITE_LENGTH,
  inviteProof,
  newInviteCode,
  sha256Hex,
  unwrapDataKey,
} from './sync/crypto';

describe('szyfrowanie', () => {
  it('klucz zawinięty hasłem daje się odwinąć tylko tym hasłem', async () => {
    const { key, wrapped } = await createDataKey('dobre hasło firmy 2026');
    const sealed = await encryptFields(key, 'clients', 'c1', { name: 'Gęś i Żuraw' });

    const again = await unwrapDataKey('dobre hasło firmy 2026', wrapped);
    expect(await decryptFields(again, 'clients', 'c1', sealed)).toEqual({ name: 'Gęś i Żuraw' });
    await expect(unwrapDataKey('złe hasło firmy 2026', wrapped)).rejects.toBeInstanceOf(CryptoError);
  });

  it('za krótkie hasło jest odrzucane', async () => {
    await expect(createDataKey('krótkie')).rejects.toBeInstanceOf(CryptoError);
  });

  it('zaszyfrowane pola nie zawierają treści i zachowują typy wartości', async () => {
    const { key } = await createDataKey('dobre hasło firmy 2026');
    const fields = { name: 'Bar Alfa', amount: 12345, lines: [{ qty: 1 }], deletedAt: null, ok: true };
    const sealed = await encryptFields(key, 'jobs', 'j1', fields);
    expect(JSON.stringify(sealed)).not.toContain('Bar Alfa');
    expect(Object.keys(sealed)).toEqual(Object.keys(fields));
    expect(await decryptFields(key, 'jobs', 'j1', sealed)).toEqual(fields);
  });

  it('wartości nie da się przenieść do innego pola ani rekordu', async () => {
    const { key } = await createDataKey('dobre hasło firmy 2026');
    const sealed = await encryptFields(key, 'clients', 'c1', { name: 'A', phone: '500' });
    await expect(decryptFields(key, 'clients', 'c1', { name: sealed.phone })).rejects.toBeInstanceOf(CryptoError);
    await expect(decryptFields(key, 'clients', 'c2', { name: sealed.name })).rejects.toBeInstanceOf(CryptoError);
  });

  it('jawna wartość z serwera jest odrzucana', async () => {
    const { key } = await createDataKey('dobre hasło firmy 2026');
    await expect(decryptFields(key, 'clients', 'c1', { name: 'podrzucone' })).rejects.toBeInstanceOf(CryptoError);
  });

  it('plik zdjęcia jest szyfrowany i wraca bajt w bajt', async () => {
    const { key } = await createDataKey('dobre hasło firmy 2026');
    const original = new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' });
    const sealed = await encryptFile(key, 'a1', original);
    expect(sealed.size).toBeGreaterThan(original.size);
    const back = await decryptFile(key, 'a1', sealed, 'image/jpeg');
    expect(Array.from(new Uint8Array(await back.arrayBuffer()))).toEqual([1, 2, 3, 250]);
    await expect(decryptFile(key, 'a2', sealed, 'image/jpeg')).rejects.toBeInstanceOf(CryptoError);
  });
});

describe('zaproszenia', () => {
  it('kod ma 10 znaków bez łatwych do pomylenia', () => {
    const codes = Array.from({ length: 200 }, () => newInviteCode());
    for (const code of codes) expect(code).toMatch(new RegExp(`^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{${INVITE_LENGTH}}$`));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('dowód hasła zgadza się tylko dla tego samego klucza i kodu', async () => {
    const { key, wrapped } = await createDataKey('hasło firmy Pogromcy 2026');
    // Szef liczy dowód kluczem z urządzenia, technik kluczem odwiniętym hasłem.
    const technician = await unwrapDataKey('hasło firmy Pogromcy 2026', wrapped);
    const owner = await inviteProof(key, 'ABCDEFGH23');
    expect(await inviteProof(technician, 'ABCDEFGH23')).toBe(owner);
    expect(await inviteProof(technician, 'ABCDEFGH24')).not.toBe(owner);
    const other = await createDataKey('inne hasło innej firmy');
    expect(await inviteProof(other.key, 'ABCDEFGH23')).not.toBe(owner);
    expect(await sha256Hex(owner)).toMatch(/^[0-9a-f]{64}$/);
  });
});
