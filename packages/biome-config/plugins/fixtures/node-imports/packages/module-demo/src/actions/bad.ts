import { readFileSync } from 'node:fs'; // expect: lint/correctness/noNodejsModules
import { connect } from '@keelwerk/adapter-pg'; // expect: lint/style/noRestrictedImports
import { fetch as get } from 'undici'; // expect: lint/style/noRestrictedImports
import pg from 'pg'; // expect: lint/style/noRestrictedImports

export const used = [readFileSync, connect, get, pg];
