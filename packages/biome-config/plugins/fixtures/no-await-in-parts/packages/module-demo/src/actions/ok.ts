function* other(items: readonly number[]): Generator<number, number, number> {
  yield* items;
  return 1;
}

export function* generator(): Generator<number, number, number> {
  const next = yield* other([1]);
  return next;
}
