/**
 * The credentials being typed on the signed-out screens, shared so that moving
 * between log in and sign up keeps them. Someone who typed an address and a
 * password before realising they have no account should not have to type both
 * again to get one.
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
}

export const authForm = new AuthFormStore();
