import type { ControlStore } from '../control/control-store.ts';
import type { ApiUsageDocument } from '../core-module/api-usage-document.ts';
import { errors } from '../errors/errors.ts';

const limit = 1000;
const dayCount = 30;

type Input = {
  readonly since?: string | undefined;
  readonly until?: string | undefined;
  readonly backendId?: string | undefined;
  readonly apiVersion?: string | undefined;
  readonly item?: string | undefined;
};

function dayOf(text: string, name: string): Temporal.PlainDate {
  try {
    const day = Temporal.PlainDate.from(text, { overflow: 'reject' });
    if (day.toString() === text) return day;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  throw errors.validation(`"${text}" is not a calendar date of the form YYYY-MM-DD in ${name}.`);
}

/** `core.apiUsage`: until = input.until ?? today, since = input.since ?? until − 29 days (calendar dates, since <= until, else validation); `store.apiUsage.read({ ..., limit: 1001 })` cut to 1000 with `truncated`. */
export async function answerApiUsage(
  store: ControlStore,
  input: unknown,
  today: string,
): Promise<ApiUsageDocument> {
  const query = (input ?? {}) as Input;
  const until = dayOf(query.until ?? today, 'until');
  const since =
    query.since === undefined
      ? until.subtract({ days: dayCount - 1 })
      : dayOf(query.since, 'since');
  if (Temporal.PlainDate.compare(since, until) > 0) {
    throw errors.validation('since must not be after until.');
  }
  const totals = await store.apiUsage.read({
    since: since.toString(),
    until: until.toString(),
    ...(query.backendId === undefined ? {} : { backendId: query.backendId }),
    ...(query.apiVersion === undefined ? {} : { apiVersion: query.apiVersion }),
    ...(query.item === undefined ? {} : { item: query.item }),
    limit: limit + 1,
  });
  return { items: totals.slice(0, limit), truncated: totals.length > limit };
}
