import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthScreen, authButtonClass, authFieldClass } from '../components/AuthScreen';
import { supabase } from '../lib/supabaseClient';
import {
  classifyResetRequestError,
  passwordResetRedirectTo,
  resetRequestMessage,
  type ResetRequestPhase,
} from '../lib/passwordReset';

const PREVIEW_PHASES = new Set<ResetRequestPhase>(['sent', 'rate_limit', 'network', 'provider', 'validation']);

function readDevPreview(): ResetRequestPhase | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('preview');
  if (value && PREVIEW_PHASES.has(value as ResetRequestPhase)) return value as ResetRequestPhase;
  return null;
}

export default function ForgotPassword() {
  const preview = import.meta.env.DEV ? readDevPreview() : null;
  const [email, setEmail] = useState(import.meta.env.DEV && preview ? 'ada@example.com' : '');
  const [phase, setPhase] = useState<ResetRequestPhase>(import.meta.env.DEV && preview ? preview : 'idle');
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(
    import.meta.env.DEV && preview === 'rate_limit' ? 60 : null,
  );
  const [fieldError, setFieldError] = useState<string | null>(null);

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (preview) return;
    setFieldError(null);
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setFieldError('Enter a valid email address.');
      setPhase('validation');
      return;
    }
    setPhase('submitting');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: passwordResetRedirectTo(window.location.origin),
      });
      const failure = classifyResetRequestError(error);
      if (!failure) {
        setRetryAfterSeconds(null);
        setPhase('sent');
        return;
      }
      setRetryAfterSeconds(failure.retryAfterSeconds);
      setPhase(failure.type);
      if (failure.type === 'validation') setFieldError(resetRequestMessage('validation', trimmed, null));
    } catch (error) {
      const failure = classifyResetRequestError(error) ?? { type: 'network' as const, retryAfterSeconds: null };
      setRetryAfterSeconds(failure.retryAfterSeconds);
      setPhase(failure.type);
    }
  };

  const message = phase === 'validation' && fieldError
    ? fieldError
    : resetRequestMessage(phase, email, retryAfterSeconds);
  const isError = phase === 'rate_limit' || phase === 'network' || phase === 'provider' || phase === 'validation';

  return (
    <AuthScreen title="Reset your password">
      <p className="mb-4 text-sm text-gray-600">
        Enter the email on your KoolMovez account. If it matches an account, we will send a link to choose a new password.
      </p>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div>
          <label htmlFor="reset-email" className="block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="reset-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={authFieldClass}
            placeholder="Enter your email address"
            aria-invalid={phase === 'validation'}
            aria-describedby={message ? 'reset-request-status' : undefined}
            required
          />
        </div>

        {message ? (
          <p
            id="reset-request-status"
            data-testid="reset-request-status"
            role={isError ? 'alert' : 'status'}
            aria-live="polite"
            className={`text-sm font-medium ${isError ? 'text-red-700' : 'text-emerald-700'}`}
          >
            {message}
          </p>
        ) : null}

        {phase !== 'sent' ? (
          <button
            type="submit"
            className={authButtonClass}
            disabled={phase === 'submitting'}
            aria-busy={phase === 'submitting'}
          >
            {phase === 'submitting' ? 'Sending reset link...' : isError ? 'Try again' : 'Send reset link'}
          </button>
        ) : (
          <button
            type="button"
            className={authButtonClass}
            onClick={() => {
              setPhase('idle');
              setFieldError(null);
            }}
          >
            Use a different email
          </button>
        )}

        <p className="pt-2 text-center text-sm text-gray-600">
          <Link to="/login" className="font-semibold text-blue-600 hover:underline">
            Back to log in
          </Link>
        </p>
      </form>
    </AuthScreen>
  );
}
