import { personalSealerOf } from '../encryption/personal-sealer-of.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { validateValue } from '../fields/validate-value.ts';
import { issuesOf } from '../invoker/stages/issues-of.ts';
import { jsonHoldsLoneSurrogate } from '../json/json-holds-lone-surrogate.ts';
import { jsonHoldsNul } from '../json/json-holds-nul.ts';
import type { StreamAppendDraft } from '../protocol/stream-append-draft.ts';
import { referenceTarget } from '../registry/reference-target.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { encodeEventValue } from './encode-event-value.ts';

/** What applying a decision's append drafts reads. */
export interface AppendStreamRecordsInput {
  readonly registry: Registry;
  readonly unit: Unit;
  /** The module whose authority the decision writes with; only its own streams take appends. */
  readonly authority: string;
  readonly appends: readonly StreamAppendDraft[];
}

/**
 * Applies a decision's append drafts in its unit, in order: per draft, the stream must exist
 * (`internal`) and belong to `authority` (`forbidden`), the key must be a valid reference and each
 * record must pass the record shape (`validation`). An empty batch is skipped. Records are
 * encoded, sealed when the unit seals, then stored with `unit.streams.append`. A later failure
 * rolls the unit back.
 */
export async function appendStreamRecords(input: AppendStreamRecordsInput): Promise<void> {
  const { registry, unit, authority } = input;
  for (const draft of input.appends) {
    const entry = registry.streams.get(draft.stream);
    if (entry === undefined) {
      throw errors.internal(`the stream ${draft.stream} is not part of this app`);
    }
    if (entry.module !== authority) {
      throw new KeelwerkError({
        kind: 'forbidden',
        code: 'core.forbidden',
        message: `"${authority}" may not append to ${entry.ref}: a module appends to its own streams only.`,
        details: { stream: entry.ref, draft: 'append' },
      });
    }
    const keyed = validateValue(entry.key, draft.key);
    if (keyed.issues !== undefined) {
      throw errors.validation(`The key of a record of ${entry.ref} is not valid.`, {
        issues: issuesOf(keyed.issues).map((issue) => ({ ...issue, path: ['key', ...issue.path] })),
      });
    }
    const key = keyed.value as string;
    if (draft.records.length === 0) continue;
    const encoded: unknown[] = [];
    for (const record of draft.records) {
      const checked = await entry.record['~standard'].validate(record);
      if (checked.issues !== undefined) {
        throw errors.validation(`A record of ${entry.ref} is not valid.`, {
          issues: issuesOf(checked.issues),
        });
      }
      const value = encodeEventValue(checked.value);
      const text = JSON.stringify(value);
      if (jsonHoldsNul(text)) {
        throw errors.validation(`A record of ${entry.ref} is not valid.`, {
          issues: [
            { path: [], message: 'A text holds U+0000, which a stream record cannot keep.' },
          ],
        });
      }
      if (jsonHoldsLoneSurrogate(text)) {
        throw errors.validation(`A record of ${entry.ref} is not valid.`, {
          issues: [
            { path: [], message: 'A text holds a lone surrogate, which has no UTF-8 form.' },
          ],
        });
      }
      encoded.push(value);
    }
    const sealer = personalSealerOf(unit);
    let stored: readonly unknown[] = encoded;
    if (sealer !== undefined) {
      const target = referenceTarget(entry.key.ref, entry.module);
      const keyedEntry =
        target === null ? undefined : registry.entities.get(`${target.module}.${target.entity}`);
      if (keyedEntry === undefined) {
        throw errors.internal(`the key of the stream ${entry.ref} references no entity`);
      }
      stored = await sealer.sealRecords({
        stream: entry,
        keyed: keyedEntry,
        key,
        records: encoded,
      });
    }
    await unit.streams.append(entry.ref, key, stored);
  }
}
