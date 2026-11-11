/**
 * Awaits `work` for at most `ms` of real time. Work that has not settled by then fails with an
 * ordinary error, thrown inside the caller's unit so the unit rolls back and gives its connection and
 * row locks back. The work itself cannot be cancelled: it keeps running, and once the unit has ended
 * the adapters refuse every statement it still sends, so it can write nothing. Its late failure,
 * that refusal included, goes to `onLate` once; it is never an unhandled rejection. `onExpire` runs
 * at the moment the deadline fires, before the unit's rollback: work that resumes while the rollback
 * is in flight changes what the caller sees afterwards, so the caller takes its snapshot there.
 * Abandoned work is listed in `abandoned` until it settles, so the owner of the set knows whether
 * something it started is still running (a consume that never returns still makes its calls).
 * `work` is handed an `expired` check that throws once the deadline has fired: a step that resumes
 * late, a read that was already on its way, calls it before it does anything with an effect.
 */
export async function withinDeadline<T>(
  ms: number,
  hooks: {
    readonly onLate: (error: unknown) => void;
    readonly onExpire?: () => void;
    readonly abandoned?: Set<Promise<unknown>>;
  },
  work: (expired: () => void) => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hasExpired = false;
  const reason = (): Error => new Error(`the consumer did not finish within ${ms} ms`);
  const expired = (): void => {
    if (hasExpired) throw reason();
  };
  const running = (async () => work(expired))();
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      hasExpired = true;
      hooks.abandoned?.add(running);
      hooks.onExpire?.();
      reject(reason());
    }, ms);
  });
  try {
    return await Promise.race([running, late]);
  } finally {
    clearTimeout(timer);
    if (hasExpired) {
      running.then(
        () => hooks.abandoned?.delete(running),
        (error: unknown) => {
          hooks.abandoned?.delete(running);
          hooks.onLate(error);
        },
      );
    }
  }
}
