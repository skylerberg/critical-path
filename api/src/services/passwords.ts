import argon2 from 'argon2';

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Fixed argon2id hash of a throwaway string. Login verifies against it when
// the email is unknown so unknown-email and wrong-password responses take the
// same time (no account-enumeration timing oracle).
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$kxe2X3UmiK6KIEdheol9yA$4EkUGsZPfPnPm5heHSxj4mq4oCH131gXs1QamKga2w0';

export async function verifyDummyPassword(password: string): Promise<void> {
  await verifyPassword(DUMMY_PASSWORD_HASH, password);
}
