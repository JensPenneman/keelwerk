import { errors } from '@keelwerk/core';
import { assertRoleName } from '@keelwerk/data';

/**
 * The role a placement url logs in as: the user name of the url, undefined when it names none.
 * A name that is not a plain lower-case role name is a configuration error naming the placement.
 */
export function placementRole(placementId: string, url: string | undefined): string | undefined {
  if (url === undefined || url === '') return undefined;
  let user: string;
  try {
    user = decodeURIComponent(new URL(url).username);
  } catch {
    return undefined;
  }
  if (user === '') return undefined;
  try {
    return assertRoleName(user);
  } catch {
    throw errors.validation(
      `the placement ${placementId} logs in as ${JSON.stringify(user)}, which is not a usable role name (lower-case letters, digits and underscores)`,
    );
  }
}
