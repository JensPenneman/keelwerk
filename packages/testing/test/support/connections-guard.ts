import { inject } from 'vitest';
import { guardClientConnections } from '../../src/postgres/index.ts';

guardClientConnections(inject('postgresCluster'));
