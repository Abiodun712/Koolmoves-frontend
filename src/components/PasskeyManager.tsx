import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  DEVICE_UNLOCK_EXPLANATION,
  deviceUnlockMessage,
  deviceUnlockSupported,
  listDeviceUnlocks,
  registerDeviceUnlock,
  revokeDeviceUnlock,
  type PublicPasskey,
} from '../lib/passkeyClient';

export default function PasskeyManager() {
  const supported = deviceUnlockSupported();
  const [credentials, setCredentials] = useState<PublicPasskey[]>([]);
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const token = await accessToken();
    if (!token) {
      setMessage(deviceUnlockMessage('unauthorized'));
      return;
    }
    const listed = await listDeviceUnlocks(token);
    if (!listed.ok) {
      setMessage(deviceUnlockMessage(listed.reason));
      return;
    }
    setCredentials(listed.credentials);
  }, []);

  useEffect(() => {
    // Device list is account data from the API, loaded when this screen opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch, then store the result
    void load();
  }, [load]);

  const addDevice = async () => {
    setBusy(true);
    setMessage('');
    const token = await accessToken();
    if (!token) {
      setMessage(deviceUnlockMessage('unauthorized'));
      setBusy(false);
      return;
    }
    const saved = await registerDeviceUnlock(token, label);
    if (!saved.ok) {
      setMessage(deviceUnlockMessage(saved.reason));
      setBusy(false);
      return;
    }
    setLabel('');
    setMessage('This device can now sign in. Your password still works.');
    await load();
    setBusy(false);
  };

  const removeDevice = async (credential: PublicPasskey) => {
    if (!window.confirm(`Remove “${credential.deviceLabel}”? Your password will still work.`)) return;
    setBusy(true);
    setMessage('');
    const token = await accessToken();
    if (!token) {
      setMessage(deviceUnlockMessage('unauthorized'));
      setBusy(false);
      return;
    }
    const removed = await revokeDeviceUnlock(token, credential.id);
    if (!removed.ok) {
      setMessage(deviceUnlockMessage(removed.reason));
      setBusy(false);
      return;
    }
    setMessage('Device sign-in was removed. Your password still works.');
    await load();
    setBusy(false);
  };

  return (
    <section className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Sign-in</p>
        <h2 className="text-lg font-extrabold text-gray-900 mt-0.5">Fingerprint, face, or device PIN</h2>
        <p className="text-xs text-gray-500 mt-1 leading-5">{DEVICE_UNLOCK_EXPLANATION}</p>
      </div>

      {credentials.length === 0 ? (
        <p className="text-sm text-slate-600">No device sign-in is saved on this account yet. Your password still works.</p>
      ) : (
        <ul className="space-y-2">
          {credentials.map((credential) => (
            <li
              key={credential.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-[#F8FAFC] p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900 break-words">{credential.deviceLabel}</p>
                <p className="text-xs text-slate-500">Added {formatWhen(credential.createdAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => void removeDevice(credential)}
                disabled={busy}
                className="shrink-0 rounded border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-white disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {supported ? (
        <div className="space-y-2">
          <label className="block text-[10px] uppercase font-bold text-gray-400" htmlFor="device-label">
            Name for this device
          </label>
          <input
            id="device-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={80}
            placeholder="This phone"
            className="w-full rounded border border-gray-300 p-2 text-sm text-gray-900"
          />
          <button
            type="button"
            onClick={() => void addDevice()}
            disabled={busy}
            className="rounded bg-[#0F172A] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? 'Waiting for this device...' : 'Add this device'}
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-600">{deviceUnlockMessage('unsupported')}</p>
      )}

      {message && <p className="text-sm text-slate-700">{message}</p>}
    </section>
  );
}

async function accessToken(): Promise<string | null> {
  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData.user) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'on an unknown date';
  return date.toLocaleDateString();
}
