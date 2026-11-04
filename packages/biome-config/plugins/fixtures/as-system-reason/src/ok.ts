import { invoke, system } from '@keelwerk/core';
import { action } from './action.ts';

export function run(input: string, reason: string): unknown {
  invoke(action, input, { as: system('nightly cleanup') });
  return invoke(action, input, { as: system(reason) });
}
