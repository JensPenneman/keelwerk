/** One stored event in a trace; the payload stays out (it can hold sealed values), the chain link is in. */
export interface TraceEvent {
  readonly eventId: string;
  /** Decimal text: positions are 64-bit. */
  readonly position: string;
  readonly stream: string;
  readonly version: number;
  readonly type: string;
  readonly recordedAt: string;
  readonly hash: string | null;
}

/** An effect of a command: its stream `core.effect/<id>` and the commands it caused. */
export interface TraceEffect {
  readonly id: string;
  /** The effect's type, from its `requested` row. */
  readonly type: string | null;
  /** `requested`, `succeeded`, `failed` or `abandoned`: the last status the stream recorded. */
  readonly status: string | null;
  readonly events: readonly TraceEvent[];
  /** Commands whose causation is this effect (the continuation, section 7.9.5). */
  readonly continuations: readonly TraceCommand[];
}

/** A command with its events, its effects and the commands it caused directly. */
export interface TraceCommand {
  readonly commandId: string;
  readonly action: string | null;
  readonly actor: { readonly kind: string; readonly id: string | null };
  readonly events: readonly TraceEvent[];
  /** The decision record's part, input digest and effect ids; `null` for kernel work. */
  readonly decision: {
    readonly part: string;
    readonly inputDigest: string;
    readonly effects: readonly string[];
  } | null;
  readonly effects: readonly TraceEffect[];
  /** Commands whose causation is this command (an `invoke` effect's command). */
  readonly nested: readonly TraceCommand[];
}

/** What `keelwerk explain --trace <id>` prints (section 7.9.6). */
export interface TraceReport {
  readonly requested: { readonly kind: 'command' | 'event' | 'effect'; readonly id: string };
  readonly command: TraceCommand;
}
