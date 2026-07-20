import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored.includes(':')) {
    return password === stored;
  }
  const [salt, hash] = stored.split(':');
  const hashVerify = scryptSync(password, salt, 64).toString('hex');
  return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(hashVerify, 'hex'));
}

export function validateRnc(rnc: string): boolean {
  const digits = rnc.replace(/\D/g, '');
  return digits.length === 9 || digits.length === 11;
}
