import type { Profile } from './profile.ts';

/** The content of `profiles.json` (section 16.9.6). */
export interface ProfilesData {
  readonly current?: string;
  readonly profiles: Readonly<Record<string, Profile>>;
}
