/**
 * What is being typed on the signed-out screens, shared so that moving between
 * log in, sign up and forgot-password keeps it. Someone who typed an address
 * and a password before realising they have no account — or before realising
 * they have forgotten it — should not have to type either again to get where
 * they were going.
 *
 * In memory only — never persisted — and emptied the moment a session starts,
 * so a password lives no longer here than it did in the form it came from.
 */
class AuthFormStore {
  name = $state('');
  email = $state('');
  password = $state('');

  clear(): void {
    this.name = '';
    this.email = '';
    this.password = '';
  }

  // For the one screen that invalidates the password without ending the visit:
  // after a reset, the address is still worth carrying to the login form and the
  // password that was typed before it is the one that no longer works.
  clearPassword(): void {
    this.password = '';
  }
}

export const authForm = new AuthFormStore();
