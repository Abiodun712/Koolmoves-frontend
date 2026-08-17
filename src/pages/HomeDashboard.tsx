import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';
import InstallKoolMovezCard from '../components/InstallKoolMovezCard';
import {
  airShipmentStatusLabel,
  normalizeLogisticsShipment,
  seaShipmentStatusLabel,
} from '../types/shipment';

type RecentNotification = {
  id: string;
  source: 'Exchange' | 'Air Freight' | 'Sea Freight' | 'Platform';
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
  time: string;
  at: number;
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

function stamp(iso: string | null | undefined) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function exchangeToNotification(req: any): RecentNotification {
  const status = String(req.status || 'pending').toLowerCase();
  const amount = req.rmb_amount != null ? `${req.rmb_amount} RMB` : 'your exchange';
  const atIso = req.updated_at || req.created_at;

  if (status === 'completed' || status === 'approved') {
    return {
      id: `ex-${req.id}`,
      source: 'Exchange',
      type: 'success',
      title: 'Success Notification',
      message: `Your exchange for ${amount} was completed.`,
      time: formatRelativeTime(atIso),
      at: stamp(atIso),
    };
  }

  if (status === 'rejected') {
    return {
      id: `ex-${req.id}`,
      source: 'Exchange',
      type: 'error',
      title: 'Action Required / Error Notice',
      message: req.admin_note
        ? `Exchange for ${amount} was rejected: ${req.admin_note}`
        : `Your exchange for ${amount} was rejected.`,
      time: formatRelativeTime(atIso),
      at: stamp(atIso),
    };
  }

  if (status === 'processing') {
    return {
      id: `ex-${req.id}`,
      source: 'Exchange',
      type: 'info',
      title: 'Status Update',
      message: `Your exchange for ${amount} is now processing.`,
      time: formatRelativeTime(atIso),
      at: stamp(atIso),
    };
  }

  return {
    id: `ex-${req.id}`,
    source: 'Exchange',
    type: 'info',
    title: 'Status Update',
    message: `Exchange request for ${amount} is pending review.`,
    time: formatRelativeTime(req.created_at),
    at: stamp(req.created_at),
  };
}

export default function HomeDashboard() {
  const { user, profile } = useAuth();
  const [notifications, setNotifications] = useState<RecentNotification[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchRecentNotifications = async () => {
      setLoadingNotifications(true);
      const collected: RecentNotification[] = [];

      const { data: exchangeRows, error: exchangeError } = await supabase
        .from('exchange_requests')
        .select('id, rmb_amount, status, admin_note, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(5);

      if (!exchangeError && exchangeRows) {
        collected.push(...exchangeRows.map(exchangeToNotification));
      }

      if (profile?.km_id) {
        const { data: shipmentRows, error: shipmentError } = await supabase
          .from('shipments')
          .select('id, shipment_code, freight_type, status, created_at, updated_at')
          .eq('km_id', profile.km_id)
          .order('updated_at', { ascending: false })
          .limit(8);

        if (!shipmentError && shipmentRows) {
          shipmentRows.forEach((row) => {
            const shipment = normalizeLogisticsShipment(row);
            const freight = shipment.freight_type === 'sea' ? 'Sea Freight' : 'Air Freight';
            const label =
              freight === 'Sea Freight'
                ? seaShipmentStatusLabel(shipment.status)
                : airShipmentStatusLabel(shipment.status);
            const atIso = shipment.updated_at || shipment.created_at;
            const isDone = shipment.status === 'completed';
            const isProblem = shipment.status === 'cancelled';
            collected.push({
              id: `sh-${shipment.id}`,
              source: freight,
              type: isDone ? 'success' : isProblem ? 'error' : 'info',
              title: `${freight} update`,
              message: `${shipment.shipment_code}: ${label}.`,
              time: formatRelativeTime(atIso),
              at: stamp(atIso),
            });
          });
        }
      }

      if (user?.id) {
        const { data: packingRows, error: packingError } = await supabase
          .from('packing_requests')
          .select('id, freight_type, status, created_at, updated_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5);

        if (!packingError && packingRows) {
          packingRows.forEach((row: any) => {
            const freight = String(row.freight_type) === 'sea' ? 'Sea Freight' : 'Air Freight';
            const status = String(row.status || 'pending_packing').replace(/_/g, ' ');
            const atIso = row.updated_at || row.created_at;
            collected.push({
              id: `pk-${row.id}`,
              source: freight,
              type: 'info',
              title: `${freight} packing`,
              message: `Packing request is ${status}.`,
              time: formatRelativeTime(atIso),
              at: stamp(atIso),
            });
          });
        }
      }

      const { data: settingsRows, error: settingsError } = await supabase
        .from('site_settings')
        .select('key, value')
        .in('key', [
          'air_freight_notice',
          'sea_freight_notice',
          'platform_status',
          'offline_msg',
        ]);

      if (!settingsError && settingsRows) {
        const map: Record<string, string> = {};
        settingsRows.forEach((row: { key: string; value: string }) => {
          map[row.key] = row.value ?? '';
        });

        const airNotice = map.air_freight_notice?.trim();
        if (airNotice) {
          collected.push({
            id: 'sys-air-notice',
            source: 'Air Freight',
            type: 'info',
            title: 'Air Freight update',
            message: airNotice,
            time: 'Published',
            at: 1,
          });
        }

        const seaNotice = map.sea_freight_notice?.trim();
        if (seaNotice) {
          collected.push({
            id: 'sys-sea-notice',
            source: 'Sea Freight',
            type: 'info',
            title: 'Sea Freight update',
            message: seaNotice,
            time: 'Published',
            at: 1,
          });
        }

        const platformStatus = (map.platform_status || 'active').toLowerCase();
        const offlineMsg = map.offline_msg?.trim();
        if (platformStatus && platformStatus !== 'active' && offlineMsg) {
          collected.push({
            id: 'sys-platform',
            source: 'Platform',
            type: 'error',
            title: 'Platform update',
            message: offlineMsg,
            time: 'Published',
            at: 1,
          });
        }
      }

      collected.sort((a, b) => b.at - a.at);
      if (!cancelled) {
        setNotifications(collected.slice(0, 8));
        setLoadingNotifications(false);
      }
    };

    void fetchRecentNotifications();
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

      <section className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-4">
        <div>
          <h2 className="text-sm font-bold text-[#0F172A]">Recent Activity</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Updates from Exchange, Air Freight, Sea Freight, and the platform.
          </p>
        </div>

        {loadingNotifications ? (
          <p className="text-xs text-gray-400">Loading notifications...</p>
        ) : notifications.length === 0 ? (
          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 text-xs text-gray-600">
            No recent notifications yet. Updates about your Exchange, Air Freight and Sea Freight
            activities will appear here.
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
