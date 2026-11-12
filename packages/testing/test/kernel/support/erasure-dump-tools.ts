import { createHash, createHmac } from 'node:crypto';
import type { StorageScope } from '@keelwerk/core';
import { canonicalizeJson, deriveFieldKey } from '@keelwerk/core';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { DumpQuery } from '../../../src/index.ts';
import { dumpDatabase } from '../../../src/index.ts';
import { dumpMarker } from './erasure-dump-markers.ts';
import { type FoundEnvelope, openWithoutTag } from './erasure-envelopes.ts';
import type { erasureDumpApp } from './erasure-probe-module.ts';

const dumpAll = async (queries: readonly DumpQuery[]): Promise<string> =>
  (await Promise.all(queries.map((query) => dumpDatabase(query)))).join('\n');

/** The rows of every table named `table` in the databases the queries reach, as JSON. */
async function rowsOf(
  queries: readonly DumpQuery[],
  table: string,
): Promise<readonly Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (const query of queries) {
    const found = await query(`select schemaname from pg_tables where tablename = '${table}'`);
    for (const { schemaname } of found) {
      for (const row of await query(
        `select to_jsonb(t)::text as row from "${String(schemaname)}"."${table}" t`,
      )) {
        rows.push(JSON.parse(String(row.row)) as Record<string, unknown>);
      }
    }
  }
  return rows;
}

/** What every key that exists makes of every envelope of the dump: the markers that open, by where. */
async function openedMarkers(input: {
  readonly runtime: TestRuntime<typeof erasureDumpApp>;
  readonly envelopes: readonly FoundEnvelope[];
  readonly keys: readonly { readonly label: string; readonly material: Uint8Array }[];
  readonly markers: readonly string[];
  readonly scopes: readonly StorageScope[];
}): Promise<readonly string[]> {
  const { runtime, envelopes, keys, markers, scopes } = input;
  const opened = new Set<string>();
  const note = (text: string, how: string, table: string): void => {
    for (const marker of markers) {
      if (text.includes(marker)) opened.add(`${marker} opens through ${how} in ${table}`);
    }
  };
  for (const envelope of envelopes) {
    for (const key of keys) {
      const plain = openWithoutTag(envelope, key.material);
      if (plain !== undefined) note(plain.toString('utf8'), key.label, envelope.table);
    }
    if (envelope.kind !== 'kwv') continue;
    for (const scope of scopes) {
      const value = await runtime.sealed
        .unit(
          runtime.namespace,
          scope,
          (unit) =>
            unit.keys.openValue({
              keyId: envelope.keyId,
              nonce: new Uint8Array(envelope.nonce),
              ciphertext: new Uint8Array(envelope.sealed),
            }),
          { readOnly: true },
        )
        .catch(() => undefined);
      if (value !== undefined) {
        note(Buffer.from(value).toString('utf8'), `value key ${envelope.keyId}`, envelope.table);
      }
    }
  }
  return [...opened].sort();
}

/** The SHA-256 of the canonical command a receipt's fingerprint is made of (15.1.7), for the plain form. */
const plainFingerprint = (action: string, apiVersion: string, input: unknown): string =>
  createHash('sha256').update(canonicalizeJson({ action, apiVersion, input })).digest('hex');

/**
 * The equality tag of the planted email under the tenant's index key (14.7.9.4), as the hexadecimal
 * text a dump shows of its column: what a reader who holds the index key can look a guess up by.
 */
async function emailTagOf(
  runtime: TestRuntime<typeof erasureDumpApp>,
  scope: StorageScope,
): Promise<string> {
  const person = runtime.app.registry.entities.get('probe.person')?.descriptor;
  const personal = person?.fields.email?.personal;
  const derived = Object.values(person?.derivedIndexes ?? {}).find(
    (index) => index.field === 'email' && index.query === 'eq',
  );
  if (person === undefined || !personal || derived === undefined) throw new Error('no eq tag');
  const fieldKey = deriveFieldKey(
    await runtime.keys.derive(scope, `keelwerk/index-root/${derived.keyVersion}`, 32),
    {
      entity: 'probe.person',
      field: 'email',
      capability: 'eq',
      normaliser: `${personal.normalize.id}@${personal.normalize.version}`,
      parameters: { bits: personal.params.eq.bits },
    },
  );
  return createHmac('sha256', fieldKey)
    .update(dumpMarker.email.toLowerCase())
    .digest()
    .subarray(0, Math.ceil(personal.params.eq.bits / 8))
    .toString('hex');
}

/** The two spellings of a subject id in a text. */
const spellingsOf = (id: string): readonly string[] => [id, id.replaceAll('-', '')];

export { dumpAll, emailTagOf, openedMarkers, plainFingerprint, rowsOf, spellingsOf };
