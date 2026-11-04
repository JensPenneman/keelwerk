/**
 * An event, change record or stream record a decision appends (section 7.9.2). `kind` names the
 * draft variant (S-50); `target` is the stream type the draft appends to and `type` the event name.
 */
export interface Draft {
  readonly kind: 'create' | 'update' | 'archive' | 'restore' | 'event';
  readonly target: string;
  readonly type: string;
}
