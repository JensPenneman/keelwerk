/** A person the scenario signs up. */
export interface Person {
  readonly identifier: string;
  readonly password: string;
  readonly displayName: string;
}

/** The session cookie a browser holds (16.4.10). */
export const sessionCookie = '__Host-keelwerk_session';

/** A person nobody signed up before: a fresh address, so tests on one deployment never meet. */
export function freshPerson(name = 'ada'): Person {
  return {
    identifier: `${name}.${crypto.randomUUID().slice(0, 8)}@example.org`,
    password: `a long password ${crypto.randomUUID()}`,
    displayName: name,
  };
}

/** What a login takes of a person. */
export function credentialsOf(person: Person): { identifier: string; password: string } {
  return { identifier: person.identifier, password: person.password };
}
