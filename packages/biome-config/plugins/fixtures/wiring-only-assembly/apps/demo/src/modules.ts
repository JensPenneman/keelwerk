import { accounts } from './accounts.ts';
import { auth } from './auth.ts';

export const modules = [accounts, auth] as const;
export function assemble(): number { // expect: plugin/wiring-only-assembly
  return modules.length;
}

export class Registry {
  constructor() { // expect: plugin/wiring-only-assembly
    this.size = 0;
  }

  size: number;

  get count(): number { // expect: plugin/wiring-only-assembly
    return this.size;
  }

  set count(value: number) { // expect: plugin/wiring-only-assembly
    this.size = value;
  }
}
