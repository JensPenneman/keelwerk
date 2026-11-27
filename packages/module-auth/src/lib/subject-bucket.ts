/** The name of the bucket that counts the failed re-authentications of one subject (17.2.6). */
export function subjectBucket(subject: string): string {
  return `subject:${subject}`;
}
