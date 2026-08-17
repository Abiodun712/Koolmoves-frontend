import React from 'react';
import { Link } from 'react-router-dom';
import SupportChat from '../components/SupportChat';

export default function Support() {
  return (
    <div className="max-w-4xl mx-auto p-4 space-y-5">
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Account</p>
        <h1 className="text-lg font-extrabold text-gray-900 mt-0.5">Support</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Platform-wide help for Exchange, Air Freight, and Sea Freight.
        </p>
        <Link
          to="/home"
          className="inline-block mt-3 text-xs font-bold text-emerald-600 hover:text-emerald-700"
        >
          ← Back to Dashboard
        </Link>
      </div>
      <SupportChat />
    </div>
  );
}
