import { createDecipheriv } from 'node:crypto';
import type { DumpQuery } from '../../../src/index.ts';

/** A sealed value found in a table of the dump, in any of the three forms the kernel stores. */
interface FoundEnvelope {
  /** `schema.table`. */
  readonly table: string;
  /** `kwe`: a JSON envelope of a chain value; `kwv`: a `kwv1` text of a value key; `column`: the binary form of a sealed column. */
  readonly kind: 'kwe' | 'kwv' | 'column';
  /** The key id the envelope names (a hexadecimal text for a column). */
  readonly keyId: string;
  readonly nonce: Buffer;
  /** The ciphertext followed by the 16 bytes of the GCM tag. */
  readonly sealed: Buffer;
  /** The `kwv1` text, to open it through the key service. */
  readonly text?: string;
  /** The `$kwe` version of a `kwe` envelope: version 2 holds its plaintext padded to 32 bytes. */
  readonly version?: 1 | 2;
}

const kwvPattern = /kwv1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/g;
const columnMinimum = 1 + 16 + 12 + 16;

function walk(table: string, value: unknown, found: FoundEnvelope[]): void {
  if (Array.isArray(value)) {
    for (const member of value) walk(table, member, found);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (
      (record.$kwe === 1 || record.$kwe === 2) &&
      typeof record.k === 'string' &&
      typeof record.n === 'string' &&
      typeof record.c === 'string'
    ) {
      found.push({
        table,
        kind: 'kwe',
        version: record.$kwe,
        keyId: record.k,
        nonce: Buffer.from(record.n, 'base64url'),
        sealed: Buffer.from(record.c, 'base64url'),
      });
      return;
    }
    for (const member of Object.values(record)) walk(table, member, found);
    return;
  }
  if (typeof value !== 'string') return;
  for (const match of value.matchAll(kwvPattern)) {
    found.push({
      table,
      kind: 'kwv',
      keyId: match[1] ?? '',
      nonce: Buffer.from(match[2] ?? '', 'base64url'),
      sealed: Buffer.from(match[3] ?? '', 'base64url'),
      text: match[0],
    });
  }
  if (/^\\x[0-9a-fA-F]+$/.test(value)) {
    const bytes = Buffer.from(value.slice(2), 'hex');
    if (bytes.length >= columnMinimum && bytes[0] === 1) {
      found.push({
        table,
        kind: 'column',
        keyId: bytes.subarray(1, 17).toString('hex'),
        nonce: bytes.subarray(17, 29),
        sealed: bytes.subarray(29),
      });
    }
    return;
  }
  const first = value.trimStart()[0];
  if ((first === '{' || first === '[') && value.includes('$kwe')) {
    try {
      walk(table, JSON.parse(value), found);
    } catch {
      // Not JSON: the text holds no envelope of the JSON form.
    }
  }
}

/**
 * Every sealed value in every table of every database the deployment spans: a `$kwe` object (also
 * inside a JSON text), a `kwv1` text and the binary form of a sealed column. Rows are read as JSON,
 * so nesting and quoting are the database's own.
 */
async function envelopesIn(queries: readonly DumpQuery[]): Promise<readonly FoundEnvelope[]> {
  const found: FoundEnvelope[] = [];
  for (const query of queries) {
    const tables = await query(
      `select schemaname, tablename from pg_tables where schemaname not in ('pg_catalog', 'information_schema', 'pg_toast') order by 1, 2`,
    );
    for (const { schemaname, tablename } of tables) {
      const name = `${String(schemaname)}.${String(tablename)}`;
      const rows = await query(
        `select to_jsonb(t)::text as row from "${String(schemaname)}"."${String(tablename)}" t`,
      );
      for (const row of rows) walk(name, JSON.parse(String(row.row)), found);
    }
  }
  return found;
}

/**
 * What a 256-bit key makes of an envelope, with no check of the tag and no associated data: AES-GCM
 * encrypts with counter mode from the block after the nonce's first, so a key that is held opens
 * the text of a value whoever can guess its binding (the padding of a version 2 envelope is
 * removed). A wrong key gives noise.
 */
function openWithoutTag(envelope: FoundEnvelope, key: Uint8Array): Buffer | undefined {
  if (key.length !== 32 || envelope.nonce.length !== 12 || envelope.sealed.length < 16) {
    return undefined;
  }
  const decipher = createDecipheriv(
    'aes-256-ctr',
    key,
    Buffer.concat([envelope.nonce, Buffer.from([0, 0, 0, 2])]),
  );
  const opened = Buffer.concat([
    decipher.update(envelope.sealed.subarray(0, envelope.sealed.length - 16)),
    decipher.final(),
  ]);
  // A version 2 plaintext ends in 0x80 and zeros; with a wrong key the bytes stay as they are.
  const end = opened.lastIndexOf(0x80);
  if (envelope.version !== 2 || end < 0 || opened.subarray(end + 1).some((byte) => byte !== 0)) {
    return opened;
  }
  return opened.subarray(0, end);
}

export type { FoundEnvelope };
export { envelopesIn, openWithoutTag };
