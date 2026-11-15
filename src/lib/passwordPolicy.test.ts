import { describe, expect, it } from 'vitest';
import { validateNewPassword, MIN_PASSWORD_LENGTH } from './passwordPolicy';

describe('validateNewPassword', () => {
  it('uses the same minimum the signup form already required', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
    expect(validateNewPassword('12345', '12345')).toBe('Password must be at least 6 characters long.');
  });

  it('rejects a confirmation that does not match', () => {
    expect(validateNewPassword('123456', '123457')).toBe('Passwords do not match.');
  });

  it('accepts a matching password of the minimum length', () => {
    expect(validateNewPassword('123456', '123456')).toBeNull();
  });
});
