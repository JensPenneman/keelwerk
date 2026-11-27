import type { Position, Unit } from '@keelwerk/core';
import { erasedAnswers } from './erased-answers.ts';
import type { Settled } from './settled.ts';
import { streamKey } from './stream-key.ts';

/**
 * What follows from the answers of the rows (`settle` runs it for a page of them): found in the
 * `erased` events of the erasure, so a crash right after a row's unit, and a holder that moved
 * afterwards, lose nothing; and in what the run visited, for the streams that left no event (an
 * effect, a row of no `erased` event). Every stream that carries an event counts in `erased`.
 */
export async function settleAnswers(input: {
  readonly read: <T>(fn: (unit: Unit) => Promise<T>) => Promise<T>;
  readonly settle: (rows: readonly Settled[]) => Promise<void>;
  readonly record: Parameters<typeof erasedAnswers>[1];
  readonly pageSize: number;
  readonly erased: Set<string>;
  readonly visited: ReadonlyMap<string, Settled>;
}): Promise<void> {
  const { visited, erased, pageSize } = input;
  const answered = new Set<string>();
  for (let from: Position | null = null; ; ) {
    const after: Position | null = from;
    const { answers, next }: Awaited<ReturnType<typeof erasedAnswers>> = await input.read((u) =>
      erasedAnswers(u, input.record, { after, limit: pageSize }),
    );
    await input.settle(
      answers.map((answer) => {
        const key = streamKey(answer.stream);
        erased.add(key);
        answered.add(key);
        return { ...answer, owned: answer.owned || visited.get(key)?.owned === true };
      }),
    );
    if (next === null) break;
    from = next;
  }
  const rest = [...visited].filter(([key]) => !answered.has(key)).map(([, row]) => row);
  for (let at = 0; at < rest.length; at += pageSize)
    await input.settle(rest.slice(at, at + pageSize));
}
