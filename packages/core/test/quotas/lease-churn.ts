// A churn of several processes on one (kind, scope) whose limit is lowered in turn. The test decides
// every interleaving: a seeded sequence of steps, after each of which the rig is quiet (every unit
// that has started is parked at a barrier or has ended). Nothing here waits for time.

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** One process: takes, passes, and a barrier that parks its next units of the control store. */
export interface ChurnProcess {
  take(limit: number): Promise<() => void>;
  pass(): Promise<void>;
  /** Parks the next units of this process; answers the call that lets them go. */
  hold(): () => void;
}

export interface ChurnRig {
  readonly processes: readonly ChurnProcess[];
  /** Holds the next renews between their read and their write, for a store that can. */
  readonly stall?: () => { readonly release: () => void };
  /** Answers when every unit that has started is parked at a barrier or has ended. */
  readonly quiet: () => Promise<void>;
  /** The units of every holder in the store. */
  readonly total: () => Promise<number>;
}

export interface ChurnOutcome {
  /** Admissions after a lowering has reached every process, at a count not within the limit. */
  readonly violations: readonly string[];
  readonly admitted: number;
  readonly refused: number;
  readonly endTotal: number;
}

/**
 * Runs `steps` seeded steps, the limit going through `limits` in equal phases. After a lowering,
 * once every take under an older limit has settled and every process has finished a pass that began
 * after the lowering, no take may be admitted while the open slots stand at or over its limit. At
 * the end every slot is closed, each process passes, and the store holds nothing.
 */
export async function churn(
  rig: ChurnRig,
  plan: { readonly seed: number; readonly steps: number; readonly limits: readonly number[] },
): Promise<ChurnOutcome> {
  const { processes } = rig;
  const phase = Math.floor(plan.steps / plan.limits.length);
  const random = generator(plan.seed);
  const slots: (() => void)[][] = processes.map(() => []);
  const passing: (Promise<void> | undefined)[] = processes.map(() => undefined);
  const barriers: ((() => void) | undefined)[] = processes.map(() => undefined);
  const pending = new Map<number, number>();
  let warmAt = processes.map(() => -1);
  let stalled: { readonly release: () => void } | undefined;
  let open = 0;
  let limit = plan.limits[0] ?? 1;
  let epoch = 0;
  let loweredAt = -1;
  const violations: string[] = [];
  let admitted = 0;
  let refused = 0;
  const olderPending = (than: number): number =>
    [...pending].reduce((sum, [at, count]) => (at < than ? sum + count : sum), 0);
  const mark = (at: number, by: number): void => {
    pending.set(at, (pending.get(at) ?? 0) + by);
  };

  const ask = (index: number, process: ChurnProcess, step: number): void => {
    const asked = limit;
    const at = epoch;
    const warm = (): boolean =>
      loweredAt === epoch && at === epoch && warmAt.every((value) => value === epoch);
    mark(at, 1);
    process
      .take(asked)
      .then(
        (release) => {
          const before = open;
          open += 1;
          slots[index]?.push(release);
          if (!warm()) return;
          admitted += 1;
          if (before + 1 > asked) {
            violations.push(
              `seed ${plan.seed} step ${step}: admitted at open ${before}, limit ${asked}`,
            );
          }
        },
        () => {
          if (warm()) refused += 1;
        },
      )
      .finally(() => mark(at, -1));
  };

  const startPass = (index: number, process: ChurnProcess): void => {
    if (passing[index] !== undefined) return;
    const at = epoch;
    const eligible = olderPending(at) === 0;
    passing[index] = process
      .pass()
      .then(
        () => {
          if (eligible && at === epoch) warmAt[index] = at;
        },
        () => undefined,
      )
      .finally(() => {
        passing[index] = undefined;
      });
  };

  const toggleBarrier = (index: number, process: ChurnProcess): void => {
    const opener = barriers[index];
    barriers[index] = opener === undefined ? process.hold() : undefined;
    opener?.();
  };

  const toggleStall = (): void => {
    if (rig.stall === undefined) return;
    if (stalled === undefined) stalled = rig.stall();
    else {
      stalled.release();
      stalled = undefined;
    }
  };

  for (let step = 0; step < plan.steps; step += 1) {
    if (step > 0 && step % phase === 0) {
      const next = plan.limits[Math.min(plan.limits.length - 1, step / phase)] ?? 1;
      epoch += 1;
      if (next < limit) loweredAt = epoch;
      limit = next;
      warmAt = warmAt.map(() => -1);
    }
    const index = Math.floor(random() * processes.length);
    const process = processes[index];
    const draw = random();
    if (process === undefined) continue;
    if (draw < 0.32) {
      const own = slots[index] ?? [];
      const [release] = own.splice(Math.floor(random() * own.length), 1);
      if (release !== undefined) {
        release();
        open -= 1;
      }
    } else if (draw < 0.62) {
      for (let count = 1 + Math.floor(random() * 3); count > 0; count -= 1)
        ask(index, process, step);
    } else if (draw < 0.78) startPass(index, process);
    else if (draw < 0.88) toggleBarrier(index, process);
    else if (draw < 0.95) toggleStall();
    await rig.quiet();
  }

  for (const [index, opener] of barriers.entries()) {
    opener?.();
    barriers[index] = undefined;
  }
  stalled?.release();
  await rig.quiet();
  await Promise.all(passing);
  for (let round = 0; round < 40 && open > 0; round += 1) {
    for (const [index, process] of processes.entries()) {
      const release = slots[index]?.shift();
      if (release !== undefined) {
        release();
        open -= 1;
      }
      await process.pass();
    }
  }
  for (const process of processes) await process.pass();
  return { violations, admitted, refused, endTotal: await rig.total() };
}
