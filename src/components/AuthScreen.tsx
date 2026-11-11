import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function AuthScreen({ title, children }: { title: string; children: ReactNode }) {
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
        <h1 className="mb-6 text-center text-2xl font-bold text-gray-800">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export const authFieldClass =
  'mt-1 w-full rounded border border-gray-300 p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500';

export const authButtonClass =
  'w-full rounded bg-blue-600 py-2 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50';
