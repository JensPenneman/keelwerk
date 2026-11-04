import { readFileSync } from 'node:fs'; // expect: lint/correctness/noNodejsModules

export const used = readFileSync;
