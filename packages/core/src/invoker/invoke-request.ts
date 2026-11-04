/** The body of `POST /_keelwerk/v1/invoke` (section 16.8.2). */
export interface InvokeRequest {
  /** 'accounts.profile.deactivate'. */
  readonly action: string;
  /** Wire form; instance commands include `id` and an optional `ifVersion`. */
  readonly input?: unknown;
  readonly commandId?: string;
  readonly prefer?: 'sync' | 'async';
}
