import type { Answer } from '../protocol/answer.ts';

/** An answer the kernel gave and the decision record keeps: ids, random values, the public parts of issued secrets. */
export type RecordedAnswer = Answer;
