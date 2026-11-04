import { readFileSync } from 'node:fs';
import pg from 'pg';

export const used = [readFileSync, pg];
