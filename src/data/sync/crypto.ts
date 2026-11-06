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
