import type { CancelTimerEffect } from './cancel-timer-effect.ts';
import type { EnqueueEffect } from './enqueue-effect.ts';
import type { ExternalEffect } from './external-effect.ts';
import type { InvokeEffect } from './invoke-effect.ts';
import type { SetTimerEffect } from './set-timer-effect.ts';
import type { SettleEffect } from './settle-effect.ts';

/** Every effect the kernel performs, narrowed by `kind`. */
export type AnyEffect =
  | InvokeEffect
  | EnqueueEffect
  | SetTimerEffect
  | CancelTimerEffect
  | SettleEffect
  | ExternalEffect;
