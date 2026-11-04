import { connect } from '@keelwerk/adapter-pg'; // expect: lint/style/noRestrictedImports
import pg from 'pg'; // expect: lint/style/noRestrictedImports

export const used = [connect, pg];
