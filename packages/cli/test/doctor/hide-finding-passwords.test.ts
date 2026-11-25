import { describe, expect, test } from 'vitest';
import type { DoctorFinding } from '../../src/doctor/doctor-finding.ts';
import { hideFindingPasswords } from '../../src/doctor/hide-finding-passwords.ts';

const finding = (over: Partial<DoctorFinding>): DoctorFinding => ({
  check: 'deployment',
  severity: 'error',
  subject: 's',
  message: 'm',
  fix: 'f',
  ...over,
});

const messageOf = (message: string) => hideFindingPasswords(finding({ message })).message;

describe('the passwords doctor never prints', () => {
  test('the password part of scheme://user:password@, without decoding it', () => {
    expect(messageOf('no route to postgres://kw:p%40ss%2Fw@db1:5432/app')).toBe(
      'no route to postgres://kw:[hidden]@db1:5432/app',
    );
    expect(messageOf('refused postgres://kw:100%zz@db1/app after 3 s')).toBe(
      'refused postgres://kw:[hidden]@db1/app after 3 s',
    );
  });

  test('the value of a password parameter of a url and of a key=value connection string', () => {
    expect(messageOf('postgres://kw@db1/app?sslmode=require&password=hunter2&x=1')).toBe(
      'postgres://kw@db1/app?sslmode=require&password=[hidden]&x=1',
    );
    expect(messageOf("host=db1 user=kw password='a b c' dbname=app")).toBe(
      'host=db1 user=kw password=[hidden] dbname=app',
    );
    expect(messageOf('host=db1 user=kw password=hunter2 dbname=app')).toBe(
      'host=db1 user=kw password=[hidden] dbname=app',
    );
  });

  test('a slash in the password is part of it: everything up to the last at sign of the word', () => {
    expect(messageOf('refused postgres://kw:pa/ss/w@db1:5432/app?x=1 twice')).toBe(
      'refused postgres://kw:[hidden]@db1:5432/app?x=1 twice',
    );
    expect(messageOf('postgres://kw:one@two@db1/app and postgres://kw:three@db2/app')).toBe(
      'postgres://kw:[hidden]@db1/app and postgres://kw:[hidden]@db2/app',
    );
  });

  test.each([
    'postgres://h:5432/db?user=a@b',
    'https://registry.npmjs.org:443/@keelwerk/core',
    'postgres://db1:5432/app,ops@example.com',
  ])('a part shaped like a port is not a password: %s stays as it is', (text) => {
    expect(messageOf(`refused ${text} twice`)).toBe(`refused ${text} twice`);
  });

  test('a password of digits is hidden before an at sign, and read as a port, so left visible, before a slash', () => {
    expect(messageOf('postgres://kw:12345@db1/app')).toBe('postgres://kw:[hidden]@db1/app');
    expect(messageOf('postgres://kw:123/x@db1/app')).toBe('postgres://kw:123/x@db1/app');
  });

  test('a key that ends in password, in any case, with an equals sign or a colon, spaces and quotes around it, has its value hidden, the JSON form included', () => {
    expect(messageOf('host=db1 sslpassword=s3cret dbname=app')).toBe(
      'host=db1 sslpassword=[hidden] dbname=app',
    );
    expect(messageOf('PGPASSWORD=s3cret psql -h db1')).toBe('PGPASSWORD=[hidden] psql -h db1');
    expect(messageOf('{"password": "s3 cret", "user": "kw"}')).toBe(
      '{"password": [hidden], "user": "kw"}',
    );
    expect(messageOf('{"dbPassword":"s3cret"}')).toBe('{"dbPassword":[hidden]}');
    expect(messageOf('password: s3cret for kw')).toBe('password: [hidden] for kw');
    expect(messageOf("password = 's3 cret' and more")).toBe('password = [hidden] and more');
  });

  test('the text password = true loses its value, which is accepted, and a password word without a sign after it is left alone', () => {
    expect(messageOf('set password = true to ask for one')).toBe(
      'set password = [hidden] to ask for one',
    );
    expect(messageOf('password authentication failed for user kw')).toBe(
      'password authentication failed for user kw',
    );
  });

  test('an ordinary word that is also the password stays readable, and a url without a password is left alone', () => {
    expect(messageOf('the postgres adapter did not connect to postgres://postgres@db1/app')).toBe(
      'the postgres adapter did not connect to postgres://postgres@db1/app',
    );
  });

  test('the subject and the fix are hidden as the message is', () => {
    expect(
      hideFindingPasswords(
        finding({
          subject: 'postgres://kw:a@db1/x',
          fix: 'check postgres://kw:b@db1/x and password=c',
        }),
      ),
    ).toMatchObject({
      subject: 'postgres://kw:[hidden]@db1/x',
      fix: 'check postgres://kw:[hidden]@db1/x and password=[hidden]',
    });
  });
});
