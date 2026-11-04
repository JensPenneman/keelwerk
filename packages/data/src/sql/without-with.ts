import type { WithNode } from 'kysely';

export function withoutWith<T extends { readonly with?: WithNode }>(node: T): T {
  const { with: _with, ...rest } = node;
  return rest as T;
}
