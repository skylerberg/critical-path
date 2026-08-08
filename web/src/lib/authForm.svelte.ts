/**
 * What is being typed on the signed-out screens, shared so that moving between
 * log in, sign up and forgot-password keeps it. Someone who typed an address
 * and a password before realizing they have no account — or before realizing
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
}

export const authForm = new AuthFormStore();
