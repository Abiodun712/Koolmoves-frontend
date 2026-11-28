import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import InstallKoolMovezCard from '../components/InstallKoolMovezCard';
import { loadCustomerNotifications, type RecentNotification } from '../lib/customerNotifications';

export default function HomeDashboard() {
  const { user, profile } = useAuth();
  const [notifications, setNotifications] = useState<RecentNotification[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void loadCustomerNotifications({
      userId: user?.id ?? null,
      kmId: profile?.km_id ?? null,
    }).then((items) => {
      if (cancelled) return;
      setNotifications(items);
      setLoadingNotifications(false);
    });

    return () => {
      cancelled = true;
    };
  }, [profile?.km_id, user?.id]);

  const displayName = profile?.full_name?.trim() || 'there';

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-5">
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Dashboard</p>
        <h1 className="text-lg font-extrabold text-gray-900 mt-0.5">Welcome, {displayName}</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Your KoolMovez control center for account, services, activity, and support.
        </p>
      </div>

      <section className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[#0F172A]">Account</h2>
            <p className="text-xs text-gray-500 mt-0.5">Profile details for this KM ID.</p>
          </div>
          <Link
            to="/profile"
            className="shrink-0 text-xs font-bold text-emerald-600 hover:text-emerald-700 min-h-[44px] inline-flex items-center"
          >
            View Profile →
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-[#F8FAFC] border border-gray-100 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">KM ID</p>
            <p className="text-sm font-mono font-bold text-gray-900 mt-0.5 break-all">
              {profile?.km_id || 'Loading...'}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#F8FAFC] border border-gray-100 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Account status</p>
            <p className="text-sm font-bold text-emerald-700 mt-0.5">Active & Verified</p>
          </div>
          <div className="p-3 rounded-xl bg-[#F8FAFC] border border-gray-100 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Name</p>
            <p className="text-sm font-bold text-gray-900 mt-0.5 break-words">
              {profile?.full_name || '—'}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#F8FAFC] border border-gray-100 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Email</p>
            <p className="text-sm font-bold text-gray-900 mt-0.5 break-all">{profile?.email || '—'}</p>
          </div>
          <div className="p-3 rounded-xl bg-[#F8FAFC] border border-gray-100 min-w-0 sm:col-span-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Phone</p>
            <p className="text-sm font-bold text-gray-900 mt-0.5 break-words">{profile?.phone || '—'}</p>
          </div>
        </div>
      </section>

      <InstallKoolMovezCard />

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-bold text-[#0F172A] px-0.5">Services</h2>
          <p className="text-xs text-gray-500 mt-0.5 px-0.5">Open Exchange, Air Freight, or Sea Freight.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link
            to="/dashboard"
            className="group bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:border-emerald-300 hover:shadow-md transition-all"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center text-sm font-extrabold mb-3">
              EX
            </div>
            <h3 className="text-sm font-bold text-[#0F172A] group-hover:text-emerald-700">Exchange</h3>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Naira to RMB exchange — submit, pay, and track requests.
            </p>
            <span className="inline-block mt-4 text-xs font-bold text-emerald-600">Open Exchange →</span>
          </Link>

          <Link
            to="/air-freight"
            className="group bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:border-slate-300 hover:shadow-md transition-all"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center text-sm font-extrabold mb-3">
              AF
            </div>
            <h3 className="text-sm font-bold text-[#0F172A]">Air Freight</h3>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Warehouse address, fees, goods, and packing requests.
            </p>
            <span className="inline-block mt-4 text-xs font-bold text-emerald-600">Open Air Freight →</span>
          </Link>

          <Link
            to="/sea-freight"
            className="group bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:border-slate-300 hover:shadow-md transition-all"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center text-sm font-extrabold mb-3">
              SF
            </div>
            <h3 className="text-sm font-bold text-[#0F172A]">Sea Freight</h3>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Warehouse address, CBM goods, and packing requests.
            </p>
            <span className="inline-block mt-4 text-xs font-bold text-emerald-600">Open Sea Freight →</span>
          </Link>
        </div>
      </section>

      <section className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-4" data-testid="recent-notifications">
        <div>
          <h2 className="text-sm font-bold text-[#0F172A]">Recent notifications</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Exchange submissions, packing requests, shipments, logistics payments, and platform updates.
          </p>
        </div>

        {loadingNotifications ? (
          <p className="text-xs text-gray-400">Loading notifications...</p>
        ) : notifications.length === 0 ? (
          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 text-xs text-gray-600">
            No recent notifications yet. Exchange submissions, packing requests, and other activity
            on your account will appear here.
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`p-4 rounded-xl border text-xs flex flex-col gap-1.5 shadow-sm ${
                  n.type === 'success'
                    ? 'bg-[#10B981]/10 border-[#10B981]/40 text-[#065F46]'
                    : n.type === 'error'
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm min-w-0 truncate">{n.title}</span>
                  <span className="text-[10px] font-semibold opacity-70 whitespace-nowrap">{n.time}</span>
                </div>
                <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">{n.source}</p>
                <p className="font-semibold whitespace-pre-line break-words">{n.message}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-[#0F172A]">Support</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Chat with KoolMovez support about any service on the platform.
          </p>
        </div>
        <Link
          to="/support"
          className="shrink-0 w-full sm:w-auto text-center min-h-[44px] inline-flex items-center justify-center px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
        >
          Open Chat
        </Link>
      </section>
    </div>
  );
}
