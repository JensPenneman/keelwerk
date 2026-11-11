/**
 * An event, change record or stream record a decision appends (section 7.9.2). `kind` names the
 * draft variant (S-50); `target` is the stream type the draft appends to and `type` the event name; for an append
 * draft (`ctx.write.<module>.<stream>.append`) `target` is the stream reference.
 */
export interface Draft {
  readonly kind: 'create' | 'update' | 'archive' | 'restore' | 'event' | 'append';
  readonly target: string;
  readonly type: string;
}
