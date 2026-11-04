import type { Condition } from '@keelwerk/core';
import { renderIndexPredicate } from './render-index-predicate.ts';

/** Strips what the server adds or rewrites when it prints a predicate back: casts, quotes, parentheses, spacing and case. */
function normalise(text: string): string {
  return text
    .replace(
      /::(?:text|uuid|bigint|integer|smallint|boolean|numeric|date|jsonb|bytea|character varying|timestamp with time zone)(?:\[\])?/gi,
      '',
    )
    .replaceAll('"', '')
    .replace(/[()\s]/g, '')
    .toLowerCase();
}

/** Whether the predicate a live index reports means the condition of its snapshot. */
export function samePredicate(condition: Condition, live: string): boolean {
  return normalise(renderIndexPredicate(condition)) === normalise(live);
}
