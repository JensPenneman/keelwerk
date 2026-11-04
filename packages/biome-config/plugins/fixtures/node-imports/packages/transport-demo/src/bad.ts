import { auth } from '@keelwerk/module-auth'; // expect: lint/style/noRestrictedImports
import { invoke } from '@keelwerk/core';
import { readFileSync } from 'node:fs';

export const used = [auth, invoke, readFileSync];
