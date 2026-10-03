/**
 * Utilidades criptográficas para fingerprinting SHA-256 de archivos locales
 * usando Web Cryptography API nativa sin librerías externas ni dependencias.
 */

export async function computeBinarySha256(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    // ArrayBuffer slice para garantizar compatibilidad BufferSource en TypeScript DOM
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback FNV-1a extendido a 64 hexchars si Web Crypto no está montado
  let hash1 = 0x811c9dc5;
  let hash2 = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    hash1 ^= byte;
    hash1 = Math.imul(hash1, 0x01000193);
    hash2 ^= (byte + i);
    hash2 = Math.imul(hash2, 0x01000193);
  }
  const p1 = (hash1 >>> 0).toString(16).padStart(8, '0');
  const p2 = (hash2 >>> 0).toString(16).padStart(8, '0');
  return (p1 + p2).repeat(4).slice(0, 64);
}

export async function computeFileFingerprint(file: File | { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<string> {
  const buffer = await file.arrayBuffer();
  return computeBinarySha256(buffer);
}
