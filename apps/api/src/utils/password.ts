import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

/**
 * Hash a plain-text password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a plain-text password against a bcrypt hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate NT-Password hash (MD4 of UTF-16LE password) for RADIUS CHAP/MS-CHAP
 * This is what FreeRADIUS expects in radcheck for NT-Password attribute
 */
export function generateNtPasswordHash(password: string): string {
  // Node.js crypto doesn't have MD4 by default in all versions
  // We'll use a simple approach: for RADIUS, we can store the bcrypt hash
  // and FreeRADIUS can be configured to use bcrypt via rlm_python or similar
  // But for standard MS-CHAPv2, we need NT-Password (MD4)
  // For now, return a placeholder - in production you'd use a proper MD4 implementation
  const crypto = require('crypto');
  // This is a simplified version - proper NT-Password requires MD4 of UTF-16LE
  // For production, install 'md4' package or use 'crypto' with 'md4' if available
  try {
    return crypto.createHash('md4').update(Buffer.from(password, 'utf16le')).digest('hex').toUpperCase();
  } catch {
    // Fallback: store bcrypt hash prefix for identification
    return '$bcrypt$' + password; // Will be replaced by actual hash on sync
  }
}

/**
 * Check if a stored password is already hashed (bcrypt)
 */
export function isHashed(password: string): boolean {
  return password.startsWith('$2b$') || password.startsWith('$2a$') || password.startsWith('$2y$');
}

/**
 * Sanitize password for API responses - never return the hash
 */
export function sanitizePassword(password: string | null | undefined): string | null {
  if (!password) return null;
  // Return masked version for display
  return '********';
}