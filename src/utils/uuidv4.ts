import { randomUUID } from 'node:crypto';

// ----------------------------------------------------------------------
// RFC 4122 v4 UUID from a CSPRNG. Was a Math.random() implementation, which is
// predictable — a problem for the security-bearing IDs built on this (refresh
// familyId, newsletter confirm/unsubscribe tokens). node:crypto.randomUUID is
// the native, cryptographically-strong equivalent.

export default function uuidv4(): string {
  return randomUUID();
}
