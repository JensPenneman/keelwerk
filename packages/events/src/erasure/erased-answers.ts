import type { ErasedEventData, ErasureRecord, Position, Unit } from '@keelwerk/core';
import { sameSubject } from '@keelwerk/core';
import type { Settled } from './settled.ts';

/**
 * What this erasure's `erased` events answered, a page after `after`: the streams that carry one
 * for the subject, with the answer that event holds (`owned`). The answer is durable, so it is read
 * from the events and not from a lookup of who owns what now.
 */
export async function erasedAnswers(
  unit: Unit,
  record: Pick<ErasureRecord, 'commandId' | 'subjectId'>,
  page: { readonly after: Position | null; readonly limit: number },
): Promise<{ readonly answers: readonly Settled[]; readonly next: Position | null }> {
  const { events, next } = await unit.events.find({ commandId: record.commandId }, page);
  const answers: Settled[] = [];
  for (const event of events) {
    if (event.type !== `${event.stream.type}.erased`) continue;
    const data = event.data as Partial<ErasedEventData> | null;
    if (data !== null && sameSubject(data.subjectId, record.subjectId)) {
      answers.push({ stream: event.stream, owned: data.owned === true });
    }
  }
  return { answers, next };
}
