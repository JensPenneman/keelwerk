import type { EntityOutputSpec } from '../dsl/page-of.ts';
import type { Shape } from '../fields/shape.ts';
import type { NoOutput } from './no-output.ts';
import type { TypedOutput } from './typed-output.ts';

/** What `output` accepts. */
export type OutputSpec =
  | Shape
  | EntityOutputSpec<'page' | 'row', object>
  | NoOutput
  | TypedOutput<unknown>;
