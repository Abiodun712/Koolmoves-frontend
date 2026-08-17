import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Profile() {
  const { profile } = useAuth();

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-5">
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Account</p>
          <h1 className="text-lg font-extrabold text-gray-900 mt-0.5">Profile</h1>
          <p className="text-xs text-gray-500 mt-0.5">Your KoolMovez account information.</p>
          <Link
            to="/home"
            className="inline-block mt-3 text-xs font-bold text-emerald-600 hover:text-emerald-700"
          >
            ← Back to Dashboard
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-4 bg-[#F8FAFC] rounded-xl border border-gray-200 space-y-1 min-w-0">
            <label className="text-[10px] uppercase font-bold text-gray-400">KM ID</label>
            <p className="text-sm font-mono font-bold text-gray-900 break-all">
              {profile?.km_id || 'Pending'}
            </p>
          </div>
          <div className="p-4 bg-[#F8FAFC] rounded-xl border border-gray-200 space-y-1 min-w-0">
            <label className="text-[10px] uppercase font-bold text-gray-400">Account status</label>
            <p className="text-sm font-bold text-emerald-700">Active & Verified</p>
          </div>
          <div className="p-4 bg-[#F8FAFC] rounded-xl border border-gray-200 space-y-1 min-w-0">
            <label className="text-[10px] uppercase font-bold text-gray-400">Name</label>
            <p className="text-sm font-bold text-gray-900 break-words">{profile?.full_name || '—'}</p>
          </div>
          <div className="p-4 bg-[#F8FAFC] rounded-xl border border-gray-200 space-y-1 min-w-0">
            <label className="text-[10px] uppercase font-bold text-gray-400">Email</label>
            <p className="text-sm font-bold text-gray-900 break-all">{profile?.email || '—'}</p>
          </div>
          <div className="p-4 bg-[#F8FAFC] rounded-xl border border-gray-200 space-y-1 min-w-0 sm:col-span-2">
            <label className="text-[10px] uppercase font-bold text-gray-400">Phone</label>
            <p className="text-sm font-bold text-gray-900 break-words">{profile?.phone || '—'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
