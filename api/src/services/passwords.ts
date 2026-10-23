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

// Argon2id hash of a throwaway string, verified when login gets an unknown
// email so the unknown-email and wrong-password paths cost the same time and
// leak no account-enumeration oracle.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$kxe2X3UmiK6KIEdheol9yA$4EkUGsZPfPnPm5heHSxj4mq4oCH131gXs1QamKga2w0';

export async function verifyDummyPassword(password: string): Promise<void> {
  await verifyPassword(DUMMY_PASSWORD_HASH, password);
}
