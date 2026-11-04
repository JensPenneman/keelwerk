import { defineApp } from '@keelwerk/core';
import type { Demo } from './demo-types.ts';
import { health } from './actions/health.ts';

export const demo: Demo = defineApp({
  id: 'demo',
  actions: { health },
  decide: (input: string): string => input, // expect: plugin/wiring-only-assembly
  handle(input: string): string { // expect: plugin/wiring-only-assembly
    return input;
  },
  get handler(): number { // expect: plugin/wiring-only-assembly
    return 2;
  },
  set handler(value: number) { // expect: plugin/wiring-only-assembly
    void value;
  },
  build: function build(): number { // expect: plugin/wiring-only-assembly
    return 1;
  },
});
