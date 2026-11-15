import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getCapturedCallback, shouldHoldForRecovery } from '../lib/recoveryCallback';

export function RecoveryGate() {
  const { user, loading, recoveryPending } = useAuth();
  const location = useLocation();
  if (loading) return null;
  const hold = shouldHoldForRecovery({
    recoveryPending,
    hasUser: Boolean(user),
    callbackKind: getCapturedCallback().kind,
    pathname: location.pathname,
  });
  if (!hold) return null;
  return <Navigate to="/reset-password" replace />;
}
