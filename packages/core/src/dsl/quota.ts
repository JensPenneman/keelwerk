function builder<const K extends QuotaKind>(kind: K): QuotaBuilder<K> {
  return {
    default: (value, options) =>
      Object.freeze({ kind, default: value, level: options?.level ?? 'tenant' }),
  };
}

/** What a quota dimension counts. */
export type QuotaKind = 'bytes' | 'count' | 'rate';

/** bytes: a number or '10GiB'; count: a number; rate: '<n>/<duration>', '100/1m'. */
export type QuotaValue<K extends QuotaKind> = K extends 'bytes'
  ? number | `${number}${'B' | 'KiB' | 'MiB' | 'GiB' | 'TiB'}`
  : K extends 'count'
    ? number
    : `${number}/${string}`;

/** One quota dimension of a base: a kind, a default limit and the level whose usage it counts. */
export interface QuotaDimension<K extends QuotaKind = QuotaKind> {
  readonly kind: K;
  readonly default: string | number;
  /** Whose usage the limit counts; 'tenant' unless stated (section 12.2). */
  readonly level: 'backend' | 'tenant';
}

/** The second step of a quota declaration. */
export interface QuotaBuilder<K extends QuotaKind> {
  default(
    value: QuotaValue<K>,
    options?: { readonly level?: 'backend' | 'tenant' },
  ): QuotaDimension<K>;
}

/** `quotas: { storageBytes: quota.bytes().default('10GiB') }` on a base (section 12.2). */
export const quota: {
  bytes(): QuotaBuilder<'bytes'>;
  count(): QuotaBuilder<'count'>;
  rate(): QuotaBuilder<'rate'>;
} = Object.freeze({
  bytes: (): QuotaBuilder<'bytes'> => builder('bytes'),
  count: (): QuotaBuilder<'count'> => builder('count'),
  rate: (): QuotaBuilder<'rate'> => builder('rate'),
});
