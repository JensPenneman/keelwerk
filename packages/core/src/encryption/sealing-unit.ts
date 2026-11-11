import type { StoredEvent } from '../events/stored-event.ts';
import type { Unit } from '../storage/unit.ts';
import { createSealingContext } from './create-sealing-context.ts';
import { encryptPersonalValues } from './encrypt-personal-values.ts';
import { openPersonalValues } from './open-personal-values.ts';
import { openProcessSubject } from './open-process-subject.ts';
import { openStreamRecords } from './open-stream-records.ts';
import type { PersonalSealer } from './personal-sealer.ts';
import { personalSealerKey } from './personal-sealer-key.ts';
import { sealProcessEvent } from './seal-process-event.ts';
import { sealProcessSubject } from './seal-process-subject.ts';
import { sealStreamRecords } from './seal-stream-records.ts';
import type { SealedMembers } from './sealed-members.ts';
import type { SealingContext } from './sealing-context.ts';
import type { SealingOptions } from './sealing-options.ts';
import { sealingRows } from './sealing-rows.ts';

async function openAll(
  context: SealingContext,
  events: readonly StoredEvent[],
  sealed: SealedMembers,
): Promise<readonly StoredEvent[]> {
  const opened = [];
  for (const event of events) opened.push(await openPersonalValues(context, event, sealed));
  return opened;
}

/**
 * A unit whose row store seals personal values and rewrites conditions onto their tags (14.7.9),
 * and which carries the sealer for events. Savepoints open the same layer on the inner unit; the
 * event store is the adapter's, so chain verification sees events as stored.
 */
export function sealingUnit(unit: Unit, options: SealingOptions): Unit {
  const context = createSealingContext(unit, options);
  const sealer: PersonalSealer = {
    sealEvent: (input) => encryptPersonalValues(context, input),
    openEvents: (events) => openAll(context, events, 'keep'),
    readEvents: (events) => openAll(context, events, 'drop'),
    sealRecords: (input) => sealStreamRecords(context, input),
    openRecords: (input) => openStreamRecords(context, input),
    sealProcessEvent: (input) => sealProcessEvent(context, input),
    sealProcessSubject: (input) => sealProcessSubject(context, input),
    openProcessSubject: (input) => openProcessSubject(context, input),
  };
  const wrapped: Unit = {
    ...unit,
    rows: sealingRows(context),
    nested: (fn, nestedOptions) =>
      unit.nested((inner) => fn(sealingUnit(inner, options)), nestedOptions),
  };
  Object.defineProperty(wrapped, personalSealerKey, { value: sealer, enumerable: true });
  return wrapped;
}
