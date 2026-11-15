/** Matches the signup form: at least 6 characters, and the two entries must match. */
export const MIN_PASSWORD_LENGTH = 6;

export function validateNewPassword(password: string, confirmPassword: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return 'Password must be at least 6 characters long.';
  }
  if (password !== confirmPassword) {
    return 'Passwords do not match.';
  }
  return null;
}
