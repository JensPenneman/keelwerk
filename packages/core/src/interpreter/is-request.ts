import type { AnyRequest } from '../protocol/any-request.ts';

const requestKinds: readonly string[] = [
  'load',
  'maybe',
  'ask',
  'all',
  'flag',
  'id',
  'random',
  'secret',
  'compute',
  'perform',
];

/** Whether a value is a request: a plain value with a request `kind` and the one-step iterator (section 7.9.2). */
export function isRequest(value: unknown): value is AnyRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof value.kind === 'string' &&
    requestKinds.includes(value.kind) &&
    Symbol.iterator in value
  );
}
