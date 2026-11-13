import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * AES-256-GCM encryption for Pronesoft client secrets stored per tenant.
 * Key material comes from the ECF_SECRET_KEY env var (any string — hashed
 * to 32 bytes). Output format: base64(iv).base64(tag).base64(ciphertext)
 */
function getKey(): Buffer {
  const secret = process.env.ECF_SECRET_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('ECF_SECRET_KEY (or JWT_SECRET fallback) is not configured');
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted secret format');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
