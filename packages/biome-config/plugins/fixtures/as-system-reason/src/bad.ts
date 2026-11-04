import { invoke, system } from '@keelwerk/core';
import { action } from './action.ts';

export function run(input: string): unknown {
  invoke(action, input, { as: system() }); // expect: plugin/as-system-reason
  invoke(action, input, { as: system('') }); // expect: plugin/as-system-reason
  invoke(action, input, { as: system("") }); // expect: plugin/as-system-reason
  invoke(action, input, { as: system(' ') }); // expect: plugin/as-system-reason
  return invoke(action, input, { as: system(``) }); // expect: plugin/as-system-reason
}
