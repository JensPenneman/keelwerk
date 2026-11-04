import type { TypedOutput } from '../model/typed-output.ts';

/** `output: typedOutput<ApiSurface>()`: a result typed by `T` that is not a shape (section 4.3). */
export function typedOutput<T>(): TypedOutput<T> {
  return { kind: 'typedOutput' };
}
