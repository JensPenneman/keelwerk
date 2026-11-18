import { sealedKeyIds } from '../encryption/sealed-key-ids.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataKey } from '../storage/data-key.ts';
import type { Unit } from '../storage/unit.ts';
import { decisionDigest } from '../write-path/decision-digest.ts';
import { replayKeyDestroyed } from './replay-key-destroyed.ts';

/**
 * The data keys of the `$kwe` envelopes in `data` and `before` of the events that are chain-hashed;
 * `core.replay_key_destroyed` when one is gone.
 */
async function keysOf(unit: Unit, events: readonly StoredEvent[]): Promise<readonly DataKey[]> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.transient) continue;
    for (const id of sealedKeyIds(event.data)) ids.add(id);
    for (const id of sealedKeyIds(event.before)) ids.add(id);
  }
  const keys: DataKey[] = [];
  for (const id of ids) {
    const key = await unit.keys.keyById(id);
    if (key === undefined) throw replayKeyDestroyed('a personal value of the decision');
    keys.push(key);
  }
  return keys;
}

/**
 * The input digest a decision record must hold for `fingerprint` (7.9.6, WP-130): the digest
 * `attemptCommand` stored, rebuilt from the events the command wrote. It is keyed under the data
 * keys of the `$kwe` envelopes in `data` and `before` of the decision's own non-transient events
 * in entity streams other than `core.effect`; when the first event is an event of `core.effect`
 * (a decision that wrote no row), it is rekeyed again with the keys of that event's own sealed
 * input, as `writeEffectRecord` did. Throws `core.replay_key_destroyed` when a key is gone.
 */
export async function recordedDecisionDigest(
  unit: Unit,
  registry: Registry,
  events: readonly StoredEvent[],
  fingerprint: string,
): Promise<string> {
  const first = events[0];
  if (first === undefined) return fingerprint;
  const entityEvents = events.filter(
    (event) =>
      event.action === first.action &&
      event.stream.type !== 'core.effect' &&
      registry.entities.has(event.stream.type),
  );
  const digest = decisionDigest(fingerprint, await keysOf(unit, entityEvents));
  if (first.stream.type !== 'core.effect') return digest;
  return decisionDigest(digest, await keysOf(unit, [first]));
}
