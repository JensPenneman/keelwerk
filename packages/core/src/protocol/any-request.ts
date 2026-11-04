import type { AllRequest } from './all-request.ts';
import type { AskRequest } from './ask-request.ts';
import type { ComputeRequest } from './compute-request.ts';
import type { FlagRequest } from './flag-request.ts';
import type { IdRequest } from './id-request.ts';
import type { LoadRequest } from './load-request.ts';
import type { MaybeRequest } from './maybe-request.ts';
import type { PerformRequest } from './perform-request.ts';
import type { RandomRequest } from './random-request.ts';
import type { SecretRequest } from './secret-request.ts';

/** Every request the interpreter answers, narrowed by `kind`. */
export type AnyRequest =
  | LoadRequest
  | MaybeRequest
  | AskRequest
  | AllRequest
  | FlagRequest
  | IdRequest
  | RandomRequest
  | SecretRequest
  | ComputeRequest
  | PerformRequest;
