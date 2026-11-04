import { run } from './run.ts';

run(); // expect: plugin/no-import-effects
run.bind(null); // expect: plugin/no-import-effects
(() => run())(); // expect: plugin/no-import-effects
export const bound = 1;
