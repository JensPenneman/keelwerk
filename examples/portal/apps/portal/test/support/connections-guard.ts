import { guardClientConnections } from '@keelwerk/testing/postgres';
import { inject } from 'vitest';

guardClientConnections(inject('portalCluster'));
