const instantText = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function sameMillisecond(recorded: string, redecided: string): boolean {
  if (!instantText.test(recorded) || !instantText.test(redecided)) return false;
  try {
    return (
      Temporal.Instant.from(recorded).epochMilliseconds ===
      Temporal.Instant.from(redecided).epochMilliseconds
    );
  } catch {
    return false;
  }
}

/**
 * Lines a re-decided payload up with the recorded one at the resolution of the event store. The
 * decision's clock is the events' `recordedAt`, which the store keeps to the millisecond
 * (`timestamptz(3)`), while the instants the handler derived from it were recorded at the finer
 * resolution of the clock that ran it. Where both hold an instant of the same millisecond, the
 * result carries the recorded one; everything else is the re-decided payload unchanged.
 */
export function alignInstants(recorded: unknown, redecided: unknown): unknown {
  if (typeof redecided === 'string') {
    return typeof recorded === 'string' && sameMillisecond(recorded, redecided)
      ? recorded
      : redecided;
  }
  if (Array.isArray(redecided)) {
    const was: readonly unknown[] = Array.isArray(recorded) ? recorded : [];
    return redecided.map((member, index) => alignInstants(was[index], member));
  }
  if (typeof redecided === 'object' && redecided !== null) {
    const was: Readonly<Record<string, unknown>> =
      typeof recorded === 'object' && recorded !== null && !Array.isArray(recorded)
        ? (recorded as Readonly<Record<string, unknown>>)
        : {};
    return Object.fromEntries(
      Object.entries(redecided).map(([name, member]) => [name, alignInstants(was[name], member)]),
    );
  }
  return redecided;
}
