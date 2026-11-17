import { isErrorCode } from '../errors/is-error-code.ts';
import { isErrorKind } from '../errors/is-error-kind.ts';
import type { Id } from '../ids/id.ts';
import type { EffectStatus, EffectStatusError } from './effect-status.ts';

function statusOf(value: unknown): EffectStatus['status'] | undefined {
  return value === 'requested' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'abandoned'
    ? value
    : undefined;
}

/** The kind and code of a stored error, when both are what the closed taxonomy allows. */
function errorOf(stored: unknown): EffectStatusError | undefined {
  if (typeof stored !== 'object' || stored === null) return undefined;
  const kind: unknown = Reflect.get(stored, 'kind');
  const code: unknown = Reflect.get(stored, 'code');
  if (!isErrorKind(kind) || typeof code !== 'string' || !isErrorCode(code)) return undefined;
  return { kind, code };
}

function instantOf(value: unknown): Temporal.Instant | undefined {
  return value instanceof Temporal.Instant ? value : undefined;
}

/**
 * The status view of a `core.effect` row (the hub's presented members or the core module's own
 * read): exactly the members of `EffectStatus`; `error` as `{ kind, code }` only when `status` is
 * `failed` or `abandoned` and the stored error has a kind of the taxonomy and a stable code;
 * undefined when `id`, `type`, `status` (one of the four) or `createdAt` (a `Temporal.Instant`) is
 * missing. Reads no other member; never decides who may see the row.
 */
export function effectStatusOf(row: Readonly<Record<string, unknown>>): EffectStatus | undefined {
  const { id, type, createdAt } = row;
  const status = statusOf(row.status);
  if (typeof id !== 'string' || typeof type !== 'string' || status === undefined) return undefined;
  if (!(createdAt instanceof Temporal.Instant)) return undefined;
  const runAt = instantOf(row.runAt);
  const deadline = instantOf(row.deadline);
  const settledAt = instantOf(row.settledAt);
  const error = status === 'failed' || status === 'abandoned' ? errorOf(row.error) : undefined;
  return {
    id: id as Id<'core.effect'>,
    type,
    status,
    requestedAt: createdAt,
    ...(runAt === undefined ? {} : { runAt }),
    ...(deadline === undefined ? {} : { deadline }),
    ...(settledAt === undefined ? {} : { settledAt }),
    ...(error === undefined ? {} : { error }),
  };
}
