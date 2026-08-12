import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';

type RecentNotification = {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
  time: string;
};

function formatRelativeTime(iso: string | null | undefined) {
  if (!iso) return 'Recently';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Recently';

  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusToNotification(req: any): RecentNotification {
  const status = String(req.status || 'pending').toLowerCase();
  const amount = req.rmb_amount != null ? `${req.rmb_amount} RMB` : 'your exchange';

  if (status === 'completed' || status === 'approved') {
    return {
      id: String(req.id),
      type: 'success',
      title: 'Success Notification',
      message: `Your exchange for ${amount} was completed.`,
      time: formatRelativeTime(req.updated_at || req.created_at),
    };
  }

  if (status === 'rejected') {
    return {
      id: String(req.id),
      type: 'error',
      title: 'Action Required / Error Notice',
      message: req.admin_note
        ? `Exchange for ${amount} was rejected: ${req.admin_note}`
        : `Your exchange for ${amount} was rejected.`,
      time: formatRelativeTime(req.updated_at || req.created_at),
    };
  }

  if (status === 'processing') {
    return {
      id: String(req.id),
      type: 'info',
      title: 'Status Update',
      message: `Your exchange for ${amount} is now processing.`,
      time: formatRelativeTime(req.updated_at || req.created_at),
    };
  }

  return {
    id: String(req.id),
    type: 'info',
    title: 'Status Update',
    message: `Exchange request for ${amount} is pending review.`,
    time: formatRelativeTime(req.created_at),
  };
}

export default function HomeDashboard() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<RecentNotification[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(true);

  useEffect(() => {
    const fetchRecentNotifications = async () => {
      setLoadingNotifications(true);
      const { data, error } = await supabase
        .from('exchange_requests')
        .select('id, rmb_amount, status, admin_note, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(5);

      if (!error && data) {
        setNotifications(data.map(statusToNotification));
      } else {
        setNotifications([]);
      }
      setLoadingNotifications(false);
    };

    fetchRecentNotifications();
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const displayName = profile?.full_name?.trim() || 'there';
  const kmId = profile?.km_id || 'Loading...';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        {/* HEADER */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-lg font-extrabold text-gray-900">Welcome, {displayName}</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Choose a service to continue. Your permanent KM User ID is shown below.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-gray-900 text-white px-3 py-1.5 rounded-xl text-xs font-bold">
              ID: {kmId}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
            >
              Log Out
            </button>
          </div>
        </div>

        {/* SERVICE CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link
            to="/dashboard"
            className="group bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:border-emerald-300 hover:shadow-md transition-all"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center text-sm font-extrabold mb-3">
              EX
            </div>
            <h2 className="text-sm font-bold text-[#0F172A] group-hover:text-emerald-700">Exchange</h2>
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
            <h2 className="text-sm font-bold text-[#0F172A]">Air Freight</h2>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Air logistics booking — coming soon.
            </p>
            <span className="inline-block mt-4 text-xs font-bold text-slate-500">View placeholder →</span>
          </Link>

          <Link
            to="/sea-freight"
            className="group bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:border-slate-300 hover:shadow-md transition-all"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center text-sm font-extrabold mb-3">
              SF
            </div>
            <h2 className="text-sm font-bold text-[#0F172A]">Sea Freight</h2>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Sea logistics booking — coming soon.
            </p>
            <span className="inline-block mt-4 text-xs font-bold text-slate-500">View placeholder →</span>
          </Link>
        </div>

        {/* RECENT NOTIFICATIONS — reuses exchange status updates + UserDashboard notice styling */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-bold text-[#0F172A]">Recent Notifications</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Latest updates from your exchange activity.
            </p>
          </div>

          {loadingNotifications ? (
            <p className="text-xs text-gray-400">Loading notifications...</p>
          ) : notifications.length === 0 ? (
            <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 text-xs text-gray-600">
              No recent notifications yet. Submit an exchange request to see updates here.
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
                    <span className="font-bold text-sm">{n.title}</span>
                    <span className="text-[10px] font-semibold opacity-70 whitespace-nowrap">{n.time}</span>
                  </div>
                  <p className="font-semibold">{n.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
