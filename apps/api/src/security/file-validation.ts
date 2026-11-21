import fs = require('fs');
import crypto = require('crypto');

/**
 * Multer's `mimetype` is client-supplied, so KYC and compliance uploads are
 * re-checked against the file's magic bytes after the temporary file is written.
 * This is defence in depth, not malware scanning.
 */

function magic(filePath: string, length = 16): Buffer {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const read = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

function starts(buf: Buffer, bytes: number[] | string): boolean {
  const needle = typeof bytes === 'string' ? Buffer.from(bytes, 'binary') : Buffer.from(bytes);
  return buf.length >= needle.length && buf.subarray(0, needle.length).equals(needle);
}

function fail(message: string): never {
  const err: any = new Error(message);
  err.status = 400;
  throw err;
}

const KYC_MIME_RE = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/i;
const SUBMISSION_MIME_RE = /^(application\/pdf|text\/csv|application\/csv|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/zip)$/i;

export function assertAllowedKycFile(filePath: string, mimetype: string): void {
  if (!KYC_MIME_RE.test(mimetype)) fail('Only PNG, JPEG, WebP, GIF or PDF files are allowed');
  const head = magic(filePath);
  const ok =
    (/png$/i.test(mimetype) && starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (/jpeg$/i.test(mimetype) && starts(head, [0xff, 0xd8, 0xff])) ||
    (/gif$/i.test(mimetype) && (starts(head, 'GIF87a') || starts(head, 'GIF89a'))) ||
    (/webp$/i.test(mimetype) && starts(head, 'RIFF') && head.subarray(8, 12).toString('ascii') === 'WEBP') ||
    (/pdf$/i.test(mimetype) && starts(head, '%PDF-'));
  if (!ok) fail('File content does not match the declared image/PDF type');
}

export function assertAllowedSubmissionFile(filePath: string, mimetype: string): void {
  if (!SUBMISSION_MIME_RE.test(mimetype)) fail('Only PDF, CSV or XLSX files are allowed');
  const head = magic(filePath);
  if (/pdf$/i.test(mimetype)) {
    if (!starts(head, '%PDF-')) fail('File content is not a valid PDF');
    return;
  }
  if (/xlsx|zip$/i.test(mimetype)) {
    if (!starts(head, [0x50, 0x4b, 0x03, 0x04])) fail('File content is not a valid XLSX archive');
    return;
  }
  if (head.includes(0)) fail('File content is not a valid CSV');
}

export function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/** Mask all but the last 4 characters, preserving separators for human review. */
export function maskIdentityNumber(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4) return '*'.repeat(Math.max(1, raw.length));
  return raw.replace(/[0-9]/g, (match, offset: number) => {
    const digitIndex = raw.slice(0, offset).replace(/\D/g, '').length;
    return digitIndex < digits.length - 4 ? '*' : match;
  });
}
