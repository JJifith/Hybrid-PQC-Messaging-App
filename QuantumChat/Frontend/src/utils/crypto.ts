// ── AES-256-GCM via WebCrypto ─────────────────────────────────────────────────

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', asArrayBuffer(rawKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

export function bytesToB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export async function aesEncrypt(sharedKeyBytes: Uint8Array, plaintext: string) {
  return aesEncryptBytes(sharedKeyBytes, new TextEncoder().encode(plaintext));
}

export async function aesEncryptBytes(
  sharedKeyBytes: Uint8Array, data: Uint8Array
): Promise<{ encryptedContent: string; iv: string; tag: string }> {
  const key     = await importAesKey(sharedKeyBytes);
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const enc     = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asArrayBuffer(ivBytes), tagLength: 128 }, key, asArrayBuffer(data))
  );
  const cipher = enc.slice(0, enc.length - 16);
  const tag    = enc.slice(enc.length - 16);
  return {
    encryptedContent: bytesToB64(cipher),
    iv:               bytesToB64(ivBytes),
    tag:              bytesToB64(tag),
  };
}

export async function aesDecrypt(
  sharedKeyBytes: Uint8Array, encryptedContent: string, iv: string, tag: string
): Promise<string> {
  return new TextDecoder().decode(await aesDecryptBytes(sharedKeyBytes, encryptedContent, iv, tag));
}

export async function aesDecryptBytes(
  sharedKeyBytes: Uint8Array, encryptedContent: string, iv: string, tag: string
): Promise<Uint8Array> {
  const key      = await importAesKey(sharedKeyBytes);
  const cipher   = b64ToBytes(encryptedContent);
  const ivBytes  = b64ToBytes(iv);
  const tagBytes = b64ToBytes(tag);
  const combined = new Uint8Array(cipher.length + tagBytes.length);
  combined.set(cipher);
  combined.set(tagBytes, cipher.length);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: asArrayBuffer(ivBytes), tagLength: 128 }, key, asArrayBuffer(combined))
  );
}

// ── HKDF key derivation ───────────────────────────────────────────────────────

async function hkdf(secret: Uint8Array, info: string): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', asArrayBuffer(secret), { name: 'HKDF' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: asArrayBuffer(new Uint8Array(32)),
      info: asArrayBuffer(new TextEncoder().encode(info)),
    },
    base, 256
  );
  return new Uint8Array(bits);
}

export const deriveAesKey        = (s: Uint8Array) => hkdf(s, 'QuantumChat-AES-Key');
export const deriveFriendWrapKey = (s: Uint8Array) => hkdf(s, 'FriendKeyWrap');
export const deriveGroupWrapKey  = (s: Uint8Array) => hkdf(s, 'GroupKeyWrap');

// ── Private key decryption (password-based PBKDF2) ────────────────────────────
// Wire format: salt(16) | iv(12) | tag(16) | ciphertext

export async function decryptPrivateKeyWithPassword(
  encryptedB64: string, password: string
): Promise<Uint8Array> {
  const packed = b64ToBytes(encryptedB64);
  const salt   = packed.slice(0, 16);
  const iv     = packed.slice(16, 28);
  const tag    = packed.slice(28, 44);
  const cipher = packed.slice(44);

  const pwKey = await crypto.subtle.importKey(
    'raw', asArrayBuffer(new TextEncoder().encode(password)), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: asArrayBuffer(salt), iterations: 210_000, hash: 'SHA-256' },
    pwKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
  const combined = new Uint8Array(cipher.length + tag.length);
  combined.set(cipher);
  combined.set(tag, cipher.length);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: asArrayBuffer(iv), tagLength: 128 }, aesKey, asArrayBuffer(combined))
  );
}

// ── Time formatting ───────────────────────────────────────────────────────────

/** Always display in IST (Asia/Kolkata = UTC+5:30) */
export function formatTime(iso: string): string {
  // Ensure the ISO string ends with 'Z' for UTC parsing
  const utcIso = iso.endsWith('Z') ? iso : iso + 'Z';
  
  // Parse as UTC date
  const d = new Date(utcIso);
  
  // Create formatters that explicitly use Asia/Kolkata timezone
  const istFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  
  const istDateOnlyFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  // Get today's date in IST
  const todayInIst = istDateOnlyFormatter.format(new Date());
  
  // Get message date in IST
  const msgDateInIst = istDateOnlyFormatter.format(d);
  
  // If same day, show only time; otherwise show date
  if (msgDateInIst === todayInIst) {
    // Extract time parts from formatter
    const parts = istFormatter.formatToParts(d);
    const hour = parts.find(p => p.type === 'hour')?.value || '00';
    const minute = parts.find(p => p.type === 'minute')?.value || '00';
    const dayPeriod = parts.find(p => p.type === 'dayPeriod')?.value || 'AM';
    return `${hour}:${minute} ${dayPeriod}`;
  }
  
  // For dates, show in short format (MMM DD)
  const dateFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    month: 'short',
    day: 'numeric',
  });
  
  return dateFormatter.format(d);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
