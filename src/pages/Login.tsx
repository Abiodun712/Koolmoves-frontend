import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import {
  DEVICE_UNLOCK_EXPLANATION,
  deviceUnlockMessage,
  deviceUnlockSupported,
  signInWithDeviceUnlock,
} from '../lib/passkeyClient';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [deviceMessage, setDeviceMessage] = useState('');
  const [deviceLoading, setDeviceLoading] = useState(false);
  const navigate = useNavigate();
  const deviceSupported = deviceUnlockSupported();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(`Error: ${error.message}`);
      setLoading(false);
      return;
    }

    setMessage('Successfully logged in!');
    await routeAfterSession(navigate);
    setLoading(false);
  };

  const handleDeviceUnlock = async () => {
    setDeviceLoading(true);
    setDeviceMessage('');
    const result = await signInWithDeviceUnlock();
    if (!result.ok) {
      setDeviceMessage(deviceUnlockMessage(result.reason));
      setDeviceLoading(false);
      return;
    }
    await routeAfterSession(navigate);
    setDeviceLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
        <div className="mb-6 flex justify-center">
          <Link to="/" className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#0F172A] flex items-center justify-center shrink-0">
              <span className="text-sm font-extrabold tracking-tight">
                <span className="text-white">K</span>
                <span className="text-emerald-400">Mz</span>
              </span>
            </div>
            <div className="leading-tight">
              <div className="text-lg font-extrabold tracking-tight text-[#0F172A]">KoolMovez</div>
              <div className="text-[10px] font-bold tracking-wide text-emerald-600">China ↔ Nigeria</div>
            </div>
          </Link>
        </div>

        <h2 className="mb-6 text-center text-2xl font-bold text-gray-800">Welcome to KoolMovez</h2>

        <form className="space-y-4" onSubmit={handleLogin}>
          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your email address"
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
            <div className="mt-2 text-right">
              <Link
                to="/forgot-password"
                className="text-sm font-semibold text-blue-600 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          {message && <p className="text-center text-sm font-medium text-blue-600">{message}</p>}

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading || deviceLoading}
              className="w-full rounded bg-blue-600 py-2 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Logging in...' : 'Log In'}
            </button>
          </div>

          <p className="pt-2 text-center text-sm text-gray-600">
            Don't have an account?{' '}
            <Link to="/signup" className="font-semibold text-blue-600 hover:underline">
              Sign Up
            </Link>
          </p>
        </form>

        <div className="mt-5 space-y-3 border-t border-gray-200 pt-5">
          <button
            type="button"
            onClick={() => void handleDeviceUnlock()}
            disabled={!deviceSupported || loading || deviceLoading}
            className="w-full rounded border border-slate-300 bg-white py-2 font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {deviceLoading ? 'Waiting for this device...' : 'Sign in with fingerprint, face, or device PIN'}
          </button>
          <p className="text-center text-xs leading-5 text-slate-500">{DEVICE_UNLOCK_EXPLANATION}</p>
          {!deviceSupported && (
            <p className="text-center text-xs text-slate-500">
              This browser cannot use fingerprint, face, or device PIN. Use your password.
            </p>
          )}
          {deviceMessage && <p className="text-center text-sm text-slate-700">{deviceMessage}</p>}
        </div>
      </div>
    </div>
  );
};

async function routeAfterSession(navigate: (path: string) => void) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    navigate('/home');
    return;
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  navigate(profile?.role === 'admin' ? '/admin' : '/home');
}

export default Login;
