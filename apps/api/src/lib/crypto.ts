import {
  createHash,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing uses Node's built-in scrypt rather than bcrypt/argon2.
 *
 * Both of those ship native addons, and this machine has no C compiler — a
 * prebuilt-binary miss would break `npm install` outright. scrypt is in the
 * standard library, is memory-hard, and is a NIST/RFC-7914 recommended KDF.
 */
const SCRYPT_N = 16_384; // ~16MB per hash at r=8
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });

  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Constant-time verification. Returns false rather than throwing on a
 * malformed hash so a corrupt record cannot be distinguished from a wrong
 * password by timing or by error message.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const derived = await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Device secrets and refresh tokens are high-entropy random strings, so a
 * plain SHA-256 is the right primitive: there is nothing to brute-force, and
 * lookups need to be a single indexed equality match.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Ambiguity-free alphabet: no O/0, I/1/l. These passwords get read off a
 * screen and typed into the tray by hand exactly once.
 */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Generates `Xk7f-2Qmb-91Zc` style one-time passwords. */
export function generateTempPassword(groups = 3, groupSize = 4): string {
  const chunks: string[] = [];
  for (let g = 0; g < groups; g += 1) {
    let chunk = '';
    for (let i = 0; i < groupSize; i += 1) {
      chunk += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    }
    chunks.push(chunk);
  }
  return chunks.join('-');
}

/** `EMP-4021`. Collisions are handled by the caller retrying on duplicate key. */
export function generateEmployeeUserId(prefix = 'EMP'): string {
  return `${prefix}-${randomInt(1000, 10_000)}`;
}
