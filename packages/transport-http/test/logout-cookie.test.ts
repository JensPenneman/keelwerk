import { describe, expect, it } from 'vitest';
import { createFakeHost } from './support/create-fake-host.ts';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { fakeSession } from './support/fake-session.ts';
import { fakeAction, fakeSurface, voidNode } from './support/fake-surface.ts';
import { libraryActions } from './support/library-actions.ts';
import { librarySurface } from './support/library-surface.ts';
import { postJson } from './support/post-json.ts';

const own = { origin: 'https://library.example' };

describe('the logout of a session whose extension is due', () => {
  const name = '__Host-keelwerk_session';
  const renewed = `${name}=tok; Path=/; Secure; HttpOnly; SameSite=Lax`;
  const logout = fakeAction('auth.logout', {
    output: voidNode,
    hints: { http: { cookie: { clear: { name } } } },
  });
  const surface = fakeSurface([...librarySurface.actions, logout], 'sha256-logout');
  const invoker = createFakeInvoker({
    open: () => ({ ok: true, value: fakeSession({ setCookies: [renewed] }) }),
    actions: { ...libraryActions, 'auth.logout': () => ({ ok: true, value: undefined }) },
  });

  it('clears the cookie and does not set it again, though the action answers nothing', async () => {
    const { host } = createFakeHost({}, { invoker, surface });
    try {
      const response = await host.fetch(
        postJson('/_keelwerk/v1/invoke', { action: 'auth.logout' }, own),
      );
      const cookies = response.headers.getSetCookie();
      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toMatch(new RegExp(`^${name}=;`));
      expect(cookies[0]).toContain('Max-Age=0');
    } finally {
      await host.stop(100);
    }
  });

  it('still renews the cookie of an action that does not clear it', async () => {
    const { host } = createFakeHost({}, { invoker, surface });
    try {
      const response = await host.fetch(
        postJson('/_keelwerk/v1/invoke', { action: 'library.lookup' }, own),
      );
      expect(response.headers.getSetCookie()).toEqual([renewed]);
    } finally {
      await host.stop(100);
    }
  });
});
