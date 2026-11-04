import type { Invocation } from '@keelwerk/core';
import { portalSurface } from './portal-surface.ts';
import { fakeInvoker, type Mounted, mountRest } from './rest-kit.ts';

export async function mountedRest(
  respond: Parameters<typeof fakeInvoker>[0],
): Promise<Mounted & { calls: Invocation<unknown>[] }> {
  const fake = fakeInvoker(respond);
  const rest = await mountRest(portalSurface(), fake.invoker);
  return { ...rest, calls: fake.calls };
}
