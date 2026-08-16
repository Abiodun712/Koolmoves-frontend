import React from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeftRight, LayoutDashboard, Plane, Ship } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const NAV_ITEMS = [
  { to: '/home', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/dashboard', label: 'Exchange', icon: ArrowLeftRight },
  { to: '/air-freight', label: 'Air Freight', icon: Plane },
  { to: '/sea-freight', label: 'Sea Freight', icon: Ship },
] as const;

/**
 * Single authenticated app navigation for /home, /dashboard, /air-freight, /sea-freight.
 * Uses React Router Links so the existing session is preserved.
 */
export default function UserAppNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { profile, logout } = useAuth();
  const kmId = profile?.km_id || 'Loading...';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur-sm">
      <div className="max-w-4xl mx-auto px-4 py-3 space-y-3">
        <div className="flex items-center justify-between gap-3 min-w-0">
          <Link to="/home" className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#0F172A] flex items-center justify-center shrink-0">
              <span className="text-[11px] font-extrabold">
                <span className="text-white">K</span>
                <span className="text-emerald-400">Mz</span>
              </span>
            </div>
            <span className="text-sm font-extrabold text-[#0F172A] truncate">KoolMovez</span>
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            <div className="bg-gray-900 text-white px-2.5 py-1.5 rounded-xl text-[11px] font-bold max-w-[9.5rem] truncate">
              ID: {kmId}
            </div>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="bg-red-600 hover:bg-red-700 text-white min-h-[44px] px-3 py-1.5 rounded-xl text-[11px] font-bold"
            >
              Log Out
            </button>
          </div>
        </div>

        <nav className="grid grid-cols-4 gap-1.5" aria-label="KoolMovez services">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 min-h-[44px] px-1 sm:px-2 py-2 rounded-xl text-[10px] sm:text-xs font-bold text-center leading-tight ${
                  active
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-50 text-slate-700 border border-gray-200 hover:border-emerald-300 hover:text-emerald-800'
                }`}
              >
                <Icon size={15} className="shrink-0" />
                <span className="truncate w-full sm:w-auto">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

/** Single shell for authenticated user routes — one nav, no per-page duplicates. */
export function UserAppLayout() {
  return (
    <div className="min-h-screen bg-slate-50 overflow-x-hidden">
      <UserAppNav />
      <Outlet />
    </div>
  );
}
