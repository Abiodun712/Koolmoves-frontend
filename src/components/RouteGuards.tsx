import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getCapturedCallback, shouldHoldForRecovery } from '../lib/recoveryCallback';

function recoveryRedirect(recoveryPending: boolean, hasUser: boolean) {
  return shouldHoldForRecovery({
    recoveryPending,
    hasUser,
    callbackKind: getCapturedCallback().kind,
    pathname: '/home',
  });
}

export function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading, recoveryPending } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading...</div>;
  if (recoveryRedirect(recoveryPending, Boolean(user))) return <Navigate to="/reset-password" replace />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function RequireAdmin({ children }: { children: React.ReactElement }) {
  const { user, role, loading, recoveryPending } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading...</div>;
  if (recoveryRedirect(recoveryPending, Boolean(user))) return <Navigate to="/reset-password" replace />;
  if (!user) return <Navigate to="/login" replace />;
  if (role !== 'admin') return <Navigate to="/home" replace />;
  return children;
}