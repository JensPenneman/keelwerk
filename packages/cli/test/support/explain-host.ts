import { createFakeHost } from './fake-host.ts';
import { json, portalServer } from './portal-server.ts';
import { remoteProfileFiles } from './profile-files.ts';

/** A fake host whose invoke endpoint answers `answer` and keeps every request body it was sent. */
export function explainHost(answer: Record<string, unknown>, extra: Record<string, string> = {}) {
  const bodies: Record<string, unknown>[] = [];
  const fake = createFakeHost({
    files: { ...remoteProfileFiles, ...extra },
    handler: portalServer({
      invoke: (body) => {
        bodies.push(body);
        return json({ ok: true, value: answer });
      },
    }),
  });
  return { fake, bodies };
}
