import type { ApiSurface } from '@keelwerk/core';
import surface from '../fixtures/portal-surface.json' with { type: 'json' };

/** The hand-written surface of the portal fixture (section 16.2). */
export const portalSurface: ApiSurface = surface as unknown as ApiSurface;
