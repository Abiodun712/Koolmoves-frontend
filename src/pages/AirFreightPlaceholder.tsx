import React from 'react';
import { Link } from 'react-router-dom';

export default function AirFreightPlaceholder() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-lg mx-auto p-4">
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
          <div>
            <h1 className="text-lg font-extrabold text-gray-900">Air Freight</h1>
            <p className="text-xs text-gray-500 mt-1">
              This module is not available yet. Logistics will be added in a later phase.
            </p>
          </div>
          <Link
            to="/home"
            className="inline-flex text-xs font-bold text-emerald-600 hover:text-emerald-700"
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
