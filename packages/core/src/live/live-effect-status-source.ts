/** The leaf of `core.effectStatusWatch`'s description: the `core.effect` rows of these ids, for their submitter. */
export interface LiveEffectStatusSource {
  readonly kind: 'effectStatus';
  /** Raw UUIDs, deduplicated, 1 to 100. */
  readonly ids: readonly string[];
}
