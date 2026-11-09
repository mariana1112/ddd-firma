// Szyfrowanie end-to-end danych synchronizowanych z serwerem.
//
// Klucz danych (AES-256-GCM) jest losowy i wspólny dla urządzeń firmy. Na serwerze leży tylko
// w postaci zawiniętej kluczem wyprowadzonym z hasła szyfrowania (PBKDF2-SHA-256), więc bez hasła
// jest bezużyteczny. Każde pole rekordu jest szyfrowane osobno, dzięki czemu serwer nadal łączy
// zmiany różnych pól, nie widząc ich treści. Dane dodatkowe AES-GCM wiążą szyfrogram z tabelą,
// rekordem i polem, więc serwer nie może przestawić wartości między polami ani rekordami.

const PBKDF2_ITERATIONS = 600_000;
const VALUE_PREFIX = 'e1:';
export const MIN_PASSPHRASE = 12;

export class CryptoError extends Error {}

/** Klucz danych zawinięty hasłem. Jawny: bez hasła nie da się go użyć. */
export interface WrappedKey {
  v: 1;
  kdf: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  iv: string;
  wrapped: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));

function requireCrypto() {
  // WebCrypto działa tylko w bezpiecznym kontekście: https albo localhost.
  if (!crypto?.subtle) throw new CryptoError('Szyfrowanie wymaga połączenia https.');
}

async function passphraseKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase.normalize('NFC')), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const importDataKey = (raw: Uint8Array<ArrayBuffer>) =>
  crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

/** Nowy klucz danych firmy i jego postać zawinięta hasłem, do zapisania na serwerze. */
export async function createDataKey(passphrase: string): Promise<{ key: CryptoKey; wrapped: WrappedKey }> {
  requireCrypto();
  if (passphrase.length < MIN_PASSPHRASE) throw new CryptoError(`Hasło szyfrowania musi mieć co najmniej ${MIN_PASSPHRASE} znaków.`);
  const raw = random(32);
  const salt = random(16);
  const iv = random(12);
  const kek = await passphraseKey(passphrase, salt, PBKDF2_ITERATIONS);
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('data-key') }, kek, raw));
  const key = await importDataKey(raw);
  raw.fill(0);
  return {
    key,
    wrapped: {
      v: 1,
      kdf: 'PBKDF2-SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt: toBase64(salt),
      iv: toBase64(iv),
      wrapped: toBase64(wrapped),
    },
  };
}

/** Odwija klucz danych hasłem. Złe hasło kończy się błędem, a nie złym kluczem. */
export async function unwrapDataKey(passphrase: string, wrapped: WrappedKey): Promise<CryptoKey> {
  requireCrypto();
  if (wrapped.v !== 1 || wrapped.kdf !== 'PBKDF2-SHA-256') throw new CryptoError('Nieznany format klucza. Zaktualizuj aplikację.');
  const kek = await passphraseKey(passphrase, fromBase64(wrapped.salt), wrapped.iterations);
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(wrapped.iv), additionalData: encoder.encode('data-key') },
        kek,
        fromBase64(wrapped.wrapped),
      ),
    );
  } catch {
    throw new CryptoError('Nieprawidłowe hasło szyfrowania.');
  }
  const key = await importDataKey(raw);
  raw.fill(0);
  return key;
}

async function encryptBytes(key: CryptoKey, bytes: Uint8Array<ArrayBuffer>, context: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = random(12);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, key, bytes),
  );
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return out;
}

async function decryptBytes(key: CryptoKey, data: Uint8Array<ArrayBuffer>, context: string): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: data.subarray(0, 12), additionalData: encoder.encode(context) },
        key,
        data.subarray(12),
      ),
    );
  } catch {
    throw new CryptoError('Nie udało się odszyfrować danych. Klucz nie pasuje albo dane zostały zmienione.');
  }
}

const fieldContext = (tbl: string, recordId: string, field: string) => `${tbl}/${recordId}/${field}`;

/** Szyfruje wartość każdego pola osobno. Nazwy pól zostają jawne, bo po nich serwer łączy zmiany. */
export async function encryptFields(
  key: CryptoKey,
  tbl: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(fields)) {
    const sealed = await encryptBytes(key, encoder.encode(JSON.stringify(value ?? null)), fieldContext(tbl, recordId, field));
    out[field] = VALUE_PREFIX + toBase64(sealed);
  }
  return out;
}

/** Odwrotność encryptFields. Niezaszyfrowana wartość to błąd: serwer nie może wstrzyknąć jawnych danych. */
export async function decryptFields(
  key: CryptoKey,
  tbl: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || !value.startsWith(VALUE_PREFIX)) {
      throw new CryptoError(`Niezaszyfrowane pole ${tbl}.${field} w danych z serwera.`);
    }
    const plain = await decryptBytes(key, fromBase64(value.slice(VALUE_PREFIX.length)), fieldContext(tbl, recordId, field));
    out[field] = JSON.parse(decoder.decode(plain));
  }
  return out;
}

export async function encryptFile(key: CryptoKey, attachmentId: string, blob: Blob): Promise<Blob> {
  const sealed = await encryptBytes(key, new Uint8Array(await blob.arrayBuffer()), `file/${attachmentId}`);
  return new Blob([sealed], { type: 'application/octet-stream' });
}

export async function decryptFile(key: CryptoKey, attachmentId: string, blob: Blob, mime: string): Promise<Blob> {
  const plain = await decryptBytes(key, new Uint8Array(await blob.arrayBuffer()), `file/${attachmentId}`);
  return new Blob([plain], { type: mime });
}

// ---------- Zaproszenia ----------

const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITE_LENGTH = 10;

/** Losowy kod zaproszenia bez znaków łatwych do pomylenia (0/O, 1/I/L). */
export function newInviteCode(): string {
  let code = '';
  // Odrzucanie bajtów spoza wielokrotności alfabetu daje równy rozkład znaków.
  const limit = 256 - (256 % INVITE_ALPHABET.length);
  while (code.length < INVITE_LENGTH) {
    for (const b of random(32)) {
      if (b < limit && code.length < INVITE_LENGTH) code += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
    }
  }
  return code;
}

/**
 * Dowód, że urządzenie ma klucz firmy, czyli znało hasło szyfrowania. To szyfrogram stałej wartości
 * z wektorem IV wyliczonym z kodu: ten sam klucz i kod dają zawsze ten sam dowód, a bez klucza nie da się
 * go wyliczyć. IV jest inny dla każdego kodu, a jedyny tekst szyfrowany nim to te same zera, więc
 * powtórzenie IV niczego nie ujawnia. Serwer przechowuje tylko skrót dowodu.
 */
export async function inviteProof(key: CryptoKey, code: string): Promise<string> {
  requireCrypto();
  const iv = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`invite-iv/${code}`))).slice(0, 12);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`invite/${code}`) }, key, new Uint8Array(16)),
  );
  return toBase64(sealed);
}

export async function sha256Hex(text: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Konta zakładane przez admina ----------

/**
 * Przepakowuje klucz firmy: odwija go hasłem firmy i zawija hasłem tymczasowym nowego konta. Surowy klucz istnieje
 * tylko przez chwilę w pamięci urządzenia admina i jest zerowany.
 */
export async function rewrapDataKey(companyPassphrase: string, orgWrapped: WrappedKey, newPassphrase: string): Promise<WrappedKey> {
  requireCrypto();
  const kek = await passphraseKey(companyPassphrase, fromBase64(orgWrapped.salt), orgWrapped.iterations);
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(orgWrapped.iv), additionalData: encoder.encode('data-key') },
        kek,
        fromBase64(orgWrapped.wrapped),
      ),
    );
  } catch {
    throw new CryptoError('Nieprawidłowe hasło firmy (szyfrowania).');
  }
  const salt = random(16);
  const iv = random(12);
  const newKek = await passphraseKey(newPassphrase, salt, PBKDF2_ITERATIONS);
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('data-key') }, newKek, raw));
  raw.fill(0);
  return { v: 1, kdf: 'PBKDF2-SHA-256', iterations: PBKDF2_ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), wrapped: toBase64(wrapped) };
}

/**
 * Hasło konta tymczasowego dla serwera, wyliczone z hasła tymczasowego (PBKDF2, 100 000 iteracji). Serwer nie zna
 * hasła tymczasowego, którym zawinięty jest klucz firmy, więc dalej nie może odczytać danych.
 */
export async function accountPassword(tempPassword: string): Promise<string> {
  requireCrypto();
  const material = await crypto.subtle.importKey('raw', encoder.encode(tempPassword.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode('pogromcy/konto-tymczasowe'), iterations: 100_000 }, material, 256),
  );
  return toBase64(bits).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function randomText(length: number, alphabet: string): string {
  const bytes = random(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Login tymczasowy z prefiksem regionu, np. „gda-k7m2p4”. */
export function newTempLogin(prefix: string): string {
  const ascii = prefix
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z]/g, '')
    .slice(0, 5);
  return `${ascii.length >= 2 ? ascii : 'pi'}-${randomText(6, TEMP_ALPHABET)}`;
}

/** Hasło tymczasowe: 16 znaków bez mylących się liter i cyfr. */
export function newTempPassword(): string {
  return randomText(16, 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789');
}

/** Adres konta tymczasowego w Supabase Auth (domena .invalid nigdy nie odbiera poczty). */
export const TEMP_DOMAIN = 'konta.pogromcy.invalid';

export const tempEmail = (login: string) => `${login.trim().toLowerCase()}@${TEMP_DOMAIN}`;
