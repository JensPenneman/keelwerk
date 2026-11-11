/**
 * What a stream ticket looks like (the key format `kwst_<public id>_<secret>`: lower-case base32,
 * a 26 character public id and a secret of 26 to 205 characters). A value of any other form is no
 * ticket, so it costs no lookup anywhere.
 */
export const ticketPattern: RegExp = /^kwst_[a-z2-7]{26}_[a-z2-7]{26,205}$/;
