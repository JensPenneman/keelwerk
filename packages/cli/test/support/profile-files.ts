export const profilesPath = '/home/tester/.config/keelwerk/profiles.json';
export const credentialsPath = '/home/tester/.config/keelwerk/credentials.json';

/** A profile file with one remote profile "lvj" and its credential. */
export const remoteProfileFiles: Readonly<Record<string, string>> = {
  [profilesPath]: JSON.stringify({
    current: 'lvj',
    profiles: {
      lvj: { url: 'https://lvj.example', backend: 'launchway', tenant: 'jens' },
      'lvj-operator': { url: 'unix:///run/keelwerk/operator.sock' },
    },
  }),
  [credentialsPath]: JSON.stringify({ credentials: { lvj: { token: 'secret-token' } } }),
};
