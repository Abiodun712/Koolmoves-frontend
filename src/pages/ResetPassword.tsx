import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthScreen, authButtonClass, authFieldClass } from '../components/AuthScreen';
import { useAuth } from '../contexts/AuthContext';
import { validateNewPassword } from '../lib/passwordPolicy';
import {
  beginRecoveryVerification,
  classifyPasswordUpdateError,
  maskEmail,
  passwordUpdateMessage,
  postResetPath,
  recoveryProblemMessage,
  type PasswordUpdateFailure,
} from '../lib/passwordReset';
import { dismissCapturedCallback, getCapturedCallback, isRecoveryProblem, type RecoveryLinkKind } from '../lib/recoveryCallback';
import { supabase } from '../lib/supabaseClient';

type Stage =
  | { name: 'checking' }
  | { name: 'problem'; kind: RecoveryLinkKind; message: string; network: boolean }
  | { name: 'form'; failure: PasswordUpdateFailure | null }
  | { name: 'submitting' }
  | { name: 'success' };

const PREVIEW_STAGES = new Set([
  'checking',
  'form',
  'success',
  'expired',
  'reused',
  'invalid',
  'missing',
  'invalid_or_expired',
  'update_error',
  'session_expired',
  'network',
]);

function readDevPreview(): string | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('preview');
  return value && PREVIEW_STAGES.has(value) ? value : null;
}

function stageFromPreview(preview: string): Stage {
  if (preview === 'checking') return { name: 'checking' };
  if (preview === 'form') return { name: 'form', failure: null };
  if (preview === 'success') return { name: 'success' };
  if (preview === 'update_error') {
    return { name: 'form', failure: { type: 'weak_password', retryAfterSeconds: null } };
  }
  if (preview === 'session_expired') {
    return {
      name: 'problem',
      kind: 'expired',
      message: passwordUpdateMessage({ type: 'session_expired', retryAfterSeconds: null }),
      network: false,
    };
  }
  if (preview === 'network') {
    return {
      name: 'problem',
      kind: 'provider',
      message: passwordUpdateMessage({ type: 'network', retryAfterSeconds: null }),
      network: true,
    };
  }
  const kind = preview as RecoveryLinkKind;
  return { name: 'problem', kind, message: recoveryProblemMessage(kind), network: false };
}

function stageFromCallback(hasRecoverySession: boolean): Stage {
  const kind = getCapturedCallback().kind;
  if (kind === 'token_hash') return { name: 'checking' };
  if (hasRecoverySession) return { name: 'form', failure: null };
  if (kind === 'implicit') {
    return {
      name: 'problem',
      kind: 'invalid_or_expired',
      message: recoveryProblemMessage('invalid_or_expired'),
      network: false,
    };
  }
  if (isRecoveryProblem(kind)) {
    return { name: 'problem', kind, message: recoveryProblemMessage(kind), network: false };
  }
  return { name: 'problem', kind: 'none', message: recoveryProblemMessage('none'), network: false };
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const { user, role, recoveryPending, finishPasswordRecovery } = useAuth();
  const preview = import.meta.env.DEV ? readDevPreview() : null;
  const hasRecoverySession = Boolean(user) && recoveryPending;
  const [stage, setStage] = useState<Stage>(() =>
    preview ? stageFromPreview(preview) : stageFromCallback(hasRecoverySession),
  );
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [fieldOverride, setFieldOverride] = useState<string | null>(null);

  useEffect(() => {
    if (preview) return;
    const pending = beginRecoveryVerification(async (tokenHash) => {
      const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
      return { error };
    });
    if (!pending) return;
    let active = true;
    pending.then((result) => {
      if (!active) return;
      if (result.ok) {
        setStage({ name: 'form', failure: null });
        return;
      }
      const message = result.network
        ? passwordUpdateMessage({ type: 'network', retryAfterSeconds: null })
        : recoveryProblemMessage(result.kind);
      if (!result.network) finishPasswordRecovery();
      setStage({ name: 'problem', kind: result.kind, message, network: result.network });
    });
    return () => {
      active = false;
    };
  }, [finishPasswordRecovery, preview]);

  const retryVerification = () => {
    setStage({ name: 'checking' });
    const pending = beginRecoveryVerification(async (tokenHash) => {
      const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
      return { error };
    });
    if (!pending) {
      setStage({
        name: 'problem',
        kind: 'missing',
        message: recoveryProblemMessage('missing'),
        network: false,
      });
      return;
    }
    void pending.then((result) => {
      if (result.ok) {
        setStage({ name: 'form', failure: null });
        return;
      }
      setStage({
        name: 'problem',
        kind: result.kind,
        message: result.network
          ? passwordUpdateMessage({ type: 'network', retryAfterSeconds: null })
          : recoveryProblemMessage(result.kind),
        network: result.network,
      });
    });
  };

  const leaveRecovery = async (to: '/login' | '/forgot-password') => {
    if (preview) {
      navigate(to);
      return;
    }
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // The recovery flag is cleared below even if the network revoke fails.
    }
    finishPasswordRecovery();
    dismissCapturedCallback();
    navigate(to);
  };

  const requestAnotherLink = () => {
    if (preview) {
      navigate('/forgot-password');
      return;
    }
    if (recoveryPending && user) {
      void leaveRecovery('/forgot-password');
      return;
    }
    dismissCapturedCallback();
    navigate('/forgot-password');
  };

  const updatePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    const policyError = validateNewPassword(password, confirmPassword);
    if (policyError) {
      setStage({ name: 'form', failure: { type: 'validation', retryAfterSeconds: null } });
      setFieldOverride(policyError);
      return;
    }
    if (preview) return;
    setFieldOverride(null);
    setStage({ name: 'submitting' });
    try {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) {
        const failure = classifyPasswordUpdateError(error);
        if (failure.type === 'session_expired') {
          setStage({
            name: 'problem',
            kind: 'expired',
            message: passwordUpdateMessage(failure),
            network: false,
          });
          return;
        }
        setStage({ name: 'form', failure });
        return;
      }
      finishPasswordRecovery();
      dismissCapturedCallback();
      setStage({ name: 'success' });
      let nextRole = role;
      const userId = data.user?.id ?? user?.id;
      if (userId) {
        const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', userId).single();
        if (profile && typeof profile.role === 'string') nextRole = profile.role;
      }
      navigate(postResetPath(nextRole));
    } catch (error) {
      const failure = classifyPasswordUpdateError(error);
      if (failure.type === 'network' || failure.type === 'rate_limit') {
        setStage({ name: 'form', failure });
        return;
      }
      setStage({ name: 'form', failure });
    }
  };

  const formFailure = stage.name === 'form' ? stage.failure : null;
  const formMessage = fieldOverride ?? (formFailure ? passwordUpdateMessage(formFailure) : null);
  const masked = import.meta.env.DEV && preview ? 'a***@example.com' : maskEmail(user?.email);

  return (
    <AuthScreen title={stage.name === 'success' ? 'Password updated' : 'Choose a new password'}>
      {stage.name === 'checking' ? (
        <p role="status" data-testid="reset-password-status" className="text-sm text-gray-600">
          Checking your reset link...
        </p>
      ) : null}

      {stage.name === 'problem' ? (
        <div className="space-y-4">
          <p role="alert" data-testid="reset-password-status" className="text-sm font-medium text-red-700">
            {stage.message}
          </p>
          {stage.network ? (
            <button type="button" className={authButtonClass} onClick={retryVerification}>
              Try again
            </button>
          ) : (
            <button type="button" className={authButtonClass} onClick={requestAnotherLink}>
              Request a new link
            </button>
          )}
          {user && !recoveryPending ? (
            <button
              type="button"
              className="w-full rounded border border-gray-300 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              onClick={() => {
                dismissCapturedCallback();
                navigate(postResetPath(role));
              }}
            >
              Continue to your account
            </button>
          ) : null}
          <p className="text-center text-sm text-gray-600">
            <Link to="/login" className="font-semibold text-blue-600 hover:underline">
              Back to log in
            </Link>
          </p>
        </div>
      ) : null}

      {stage.name === 'form' || stage.name === 'submitting' ? (
        <form className="space-y-4" onSubmit={updatePassword} noValidate>
          <p className="text-sm text-gray-600">
            {masked ? `Choose a new password for ${masked}.` : 'Choose a new password for your account.'} Use at least 6 characters.
          </p>
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-gray-700">
              New password
            </label>
            <div className="relative">
              <input
                id="new-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={`${authFieldClass} pr-16`}
                aria-invalid={Boolean(formMessage)}
                aria-describedby={formMessage ? 'new-password-status' : 'new-password-hint'}
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-500 hover:text-gray-800"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <p id="new-password-hint" className="mt-1 text-xs text-gray-500">
              At least 6 characters.
            </p>
          </div>
          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700">
              Confirm new password
            </label>
            <div className="relative">
              <input
                id="confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className={`${authFieldClass} pr-16`}
                aria-invalid={Boolean(formMessage)}
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-500 hover:text-gray-800"
                aria-pressed={showConfirmPassword}
                onClick={() => setShowConfirmPassword((current) => !current)}
              >
                {showConfirmPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          {formMessage ? (
            <p id="new-password-status" role="alert" data-testid="reset-password-status" className="text-sm font-medium text-red-700">
              {formMessage}
            </p>
          ) : null}
          <button
            type="submit"
            className={authButtonClass}
            disabled={stage.name === 'submitting'}
            aria-busy={stage.name === 'submitting'}
          >
            {stage.name === 'submitting' ? 'Updating password...' : 'Update password'}
          </button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="font-semibold text-blue-600 hover:underline" onClick={() => void leaveRecovery('/login')}>
              Cancel
            </button>
            <button
              type="button"
              className="font-semibold text-blue-600 hover:underline"
              onClick={() => void leaveRecovery('/forgot-password')}
            >
              Use a different email
            </button>
          </div>
        </form>
      ) : null}

      {stage.name === 'success' ? (
        <p role="status" data-testid="reset-password-status" className="text-sm font-medium text-emerald-700">
          Password updated. Taking you to your account...
        </p>
      ) : null}
    </AuthScreen>
  );
}
