import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';

type WarehouseAddresses = {
  china: string | null;
  nigeria: string | null;
};

type AirFreightFees = {
  ratePerKg: string | null;
  feeNote: string | null;
};

type AirFreightGood = {
  id: string;
  date_received: string | null;
  goods_description: string | null;
  supplier_phone: string | null;
  tracking_number: string | null;
  quantity: number | null;
  weight_kg: number | null;
  photo_url: string | null;
  admin_remarks: string | null;
};

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function pickSetting(
  rows: { key: string; value: string }[] | null | undefined,
  keys: string[]
): string | null {
  if (!rows?.length) return null;
  for (const key of keys) {
    const match = rows.find((row) => row.key === key);
    const value = match?.value?.trim();
    if (value) return value;
  }
  return null;
}

function normalizeGood(row: Record<string, any>): AirFreightGood {
  return {
    id: String(row.id),
    date_received: row.date_received ?? row.received_at ?? row.created_at ?? null,
    goods_description: row.goods_description ?? row.description ?? null,
    supplier_phone: row.supplier_phone ?? null,
    tracking_number: row.tracking_number ?? null,
    quantity: row.quantity != null ? Number(row.quantity) : null,
    weight_kg:
      row.weight_kg != null
        ? Number(row.weight_kg)
        : row.weight != null
          ? Number(row.weight)
          : null,
    photo_url: row.photo_url ?? row.photo ?? null,
    admin_remarks: row.admin_remarks ?? row.remarks ?? row.admin_note ?? null,
  };
}

export default function AirFreightPlaceholder() {
  const { user, profile } = useAuth();
  const kmId = profile?.km_id || 'Loading...';

  const [addresses, setAddresses] = useState<WarehouseAddresses>({
    china: null,
    nigeria: null,
  });
  const [fees, setFees] = useState<AirFreightFees>({
    ratePerKg: null,
    feeNote: null,
  });
  const [goods, setGoods] = useState<AirFreightGood[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1500);
    } catch {
      // Clipboard may be blocked; leave UI unchanged.
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError(null);

      try {
        const { data: settingsRows } = await supabase
          .from('site_settings')
          .select('key, value')
          .in('key', [
            'china_warehouse_address',
            'nigeria_warehouse_address',
            'nigeria_pickup_address',
            'air_freight_rate_per_kg',
            'air_freight_fee',
            'air_freight_fee_info',
            'air_freight_info',
          ]);

        if (!cancelled) {
          setAddresses({
            china: pickSetting(settingsRows, ['china_warehouse_address']),
            nigeria: pickSetting(settingsRows, [
              'nigeria_warehouse_address',
              'nigeria_pickup_address',
            ]),
          });
          setFees({
            ratePerKg: pickSetting(settingsRows, [
              'air_freight_rate_per_kg',
              'air_freight_fee',
            ]),
            feeNote: pickSetting(settingsRows, [
              'air_freight_fee_info',
              'air_freight_info',
            ]),
          });
        }

        if (!user?.id && !profile?.km_id) {
          if (!cancelled) setGoods([]);
          return;
        }

        let query = supabase.from('air_freight_goods').select('*');

        if (user?.id) {
          query = query.eq('user_id', user.id);
        } else if (profile?.km_id) {
          query = query.eq('km_id', profile.km_id);
        }

        const { data, error } = await query;

        if (cancelled) return;

        if (error) {
          // Table may not be readable yet; keep page usable with empty list.
          setGoods([]);
          if (error.code !== 'PGRST116' && error.code !== '42P01') {
            setLoadError('Received goods could not be loaded right now.');
          }
        } else {
          const normalized = (data || []).map((row) => normalizeGood(row));
          normalized.sort((a, b) => {
            const aTime = a.date_received ? new Date(a.date_received).getTime() : 0;
            const bTime = b.date_received ? new Date(b.date_received).getTime() : 0;
            return bTime - aTime;
          });
          setGoods(normalized);
        }
      } catch {
        if (!cancelled) {
          setGoods([]);
          setLoadError('Received goods could not be loaded right now.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [user?.id, profile?.km_id]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = goods.length > 0 && selectedIds.size === goods.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(goods.map((item) => item.id)));
  };

  const selectedCount = selectedIds.size;
  const canCopyKmId = Boolean(profile?.km_id);
  const hasPublishedFees = Boolean(fees.ratePerKg || fees.feeNote);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto p-4 space-y-6 pb-24">
        {/* HEADER */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Logistics
            </p>
            <h1 className="text-lg font-extrabold text-gray-900 mt-0.5">Air Freight</h1>
            <p className="text-xs text-gray-500 mt-0.5 max-w-xl leading-relaxed">
              Use this page to ship goods through KoolMovez Air Freight: send packages to the China
              warehouse with your KM ID, review received goods, and prepare a shipment when booking
              opens.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-gray-900 text-white px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2">
              <span>ID: {kmId}</span>
              {canCopyKmId && (
                <button
                  type="button"
                  onClick={() => copyText('km-header', profile!.km_id)}
                  className="text-[10px] font-bold uppercase tracking-wide text-emerald-300 hover:text-emerald-200"
                >
                  {copiedKey === 'km-header' ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
            <Link
              to="/home"
              className="text-xs font-bold text-emerald-600 hover:text-emerald-700 px-2 py-1.5"
            >
              ← Home
            </Link>
          </div>
        </div>

        {/* SEPARATE FROM EXCHANGE */}
        <div className="bg-slate-100 border border-slate-200 rounded-2xl p-5 space-y-2">
          <h2 className="text-sm font-bold text-[#0F172A]">Separate from Exchange</h2>
          <p className="text-xs text-slate-700 leading-relaxed">
            Air Freight is part of KoolMovez <strong className="font-extrabold">Logistics</strong>.
            It does not replace or connect to the{' '}
            <strong className="font-extrabold">Exchange</strong> service (Naira ↔ RMB). Use Exchange
            only for currency exchange.
          </p>
          <Link
            to="/dashboard"
            className="inline-flex text-xs font-bold text-emerald-600 hover:text-emerald-700"
          >
            Open Exchange instead →
          </Link>
        </div>

        {/* KM ID INSTRUCTION */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-2">
          <h2 className="text-sm font-bold text-emerald-900">Important: Mark your goods</h2>
          <p className="text-xs text-emerald-800 leading-relaxed">
            Ask your suppliers to clearly write your permanent KM User ID{' '}
            <strong className="font-extrabold">{kmId}</strong> on every package before shipping to
            the China warehouse. Goods without a KM ID may be delayed or cannot be matched to your
            account.
          </p>
          {canCopyKmId && (
            <button
              type="button"
              onClick={() => copyText('km-instruction', profile!.km_id)}
              className="text-xs font-bold text-emerald-700 hover:text-emerald-800 underline underline-offset-2"
            >
              {copiedKey === 'km-instruction' ? 'KM ID copied' : 'Copy KM ID'}
            </button>
          )}
        </div>

        {/* FEES / INFO (only when published in site_settings) */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-3">
          <div>
            <h2 className="text-sm font-bold text-[#0F172A]">Air Freight fees &amp; info</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Rates and notes published by admin for Air Freight Logistics.
            </p>
          </div>
          {hasPublishedFees ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fees.ratePerKg && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                    Rate / fee
                  </p>
                  <p className="text-sm font-bold text-gray-900 mt-1 whitespace-pre-line">
                    {fees.ratePerKg}
                  </p>
                </div>
              )}
              {fees.feeNote && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 sm:col-span-2">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                    Additional info
                  </p>
                  <p className="text-xs text-gray-800 mt-1 whitespace-pre-line leading-relaxed">
                    {fees.feeNote}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl p-3">
              Air Freight fees have not been published by admin yet. Warehouse addresses below still
              apply when available.
            </p>
          )}
        </div>

        {/* WAREHOUSE ADDRESSES */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[#0F172A]">China Warehouse Address</h2>
                <p className="text-xs text-gray-500">Send supplier goods to this address.</p>
              </div>
              {addresses.china && (
                <button
                  type="button"
                  onClick={() => copyText('china-address', addresses.china!)}
                  className="shrink-0 text-[11px] font-bold text-emerald-600 hover:text-emerald-700"
                >
                  {copiedKey === 'china-address' ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
            {addresses.china ? (
              <p className="text-sm text-gray-800 whitespace-pre-line leading-relaxed pt-1">
                {addresses.china}
              </p>
            ) : (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                China warehouse address has not been published by admin yet.
              </p>
            )}
          </div>

          <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[#0F172A]">Nigeria Warehouse / Pickup</h2>
                <p className="text-xs text-gray-500">Shown when admin has published it.</p>
              </div>
              {addresses.nigeria && (
                <button
                  type="button"
                  onClick={() => copyText('nigeria-address', addresses.nigeria!)}
                  className="shrink-0 text-[11px] font-bold text-emerald-600 hover:text-emerald-700"
                >
                  {copiedKey === 'nigeria-address' ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
            {addresses.nigeria ? (
              <p className="text-sm text-gray-800 whitespace-pre-line leading-relaxed pt-1">
                {addresses.nigeria}
              </p>
            ) : (
              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl p-3">
                Nigeria warehouse / pickup address has not been published by admin yet.
              </p>
            )}
          </div>
        </div>

        {/* RECEIVED GOODS */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#0F172A]">Received Air Freight Goods</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Admin-entered details only. You can select items for a future shipment — editing is
                not allowed.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {goods.length > 0 && !loading && !loadError && (
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="text-xs font-bold text-emerald-600 hover:text-emerald-700 px-2 py-1.5"
                >
                  {allSelected ? 'Clear selection' : 'Select all'}
                </button>
              )}
              {selectedCount > 0 && (
                <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-3 py-1.5 rounded-xl">
                  {selectedCount} selected
                </span>
              )}
            </div>
          </div>

          {loading ? (
            <p className="text-xs text-gray-400">Loading received goods...</p>
          ) : loadError ? (
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800">
              {loadError}
            </div>
          ) : goods.length === 0 ? (
            <div className="p-6 text-center rounded-2xl border border-dashed border-gray-300 bg-slate-50 space-y-1">
              <p className="text-sm font-bold text-gray-800">No received goods yet</p>
              <p className="text-xs text-gray-500">
                When your packages arrive at the China warehouse and are logged by admin, they will
                appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {goods.map((item) => {
                const checked = selectedIds.has(item.id);
                return (
                  <label
                    key={item.id}
                    className={`block p-4 rounded-2xl border transition-all cursor-pointer ${
                      checked
                        ? 'border-emerald-300 bg-emerald-50/40 shadow-sm'
                        : 'border-gray-200 bg-[#F8FAFC] hover:border-gray-300'
                    }`}
                  >
                    <div className="flex gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-emerald-600"
                        checked={checked}
                        onChange={() => toggleSelected(item.id)}
                        aria-label={`Select goods ${item.goods_description || item.id}`}
                      />
                      <div className="flex-1 min-w-0 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold text-gray-900">
                              {item.goods_description || 'Untitled goods'}
                            </p>
                            <p className="text-[11px] text-gray-500 mt-0.5">
                              Received: {formatDate(item.date_received)}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                            <span className="px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-700">
                              Qty: {item.quantity != null && !Number.isNaN(item.quantity) ? item.quantity : '—'}
                            </span>
                            <span className="px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-700">
                              {item.weight_kg != null && !Number.isNaN(item.weight_kg)
                                ? `${item.weight_kg} kg`
                                : '— kg'}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <div className="p-2.5 rounded-xl bg-white border border-gray-100">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                              Supplier phone
                            </p>
                            <p className="font-semibold text-gray-800 mt-0.5">
                              {item.supplier_phone || '—'}
                            </p>
                          </div>
                          <div className="p-2.5 rounded-xl bg-white border border-gray-100">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                              Tracking number
                            </p>
                            <p className="font-semibold text-gray-800 mt-0.5 break-all">
                              {item.tracking_number || '—'}
                            </p>
                          </div>
                        </div>

                        {item.admin_remarks && (
                          <div className="p-2.5 rounded-xl bg-white border border-gray-100 text-xs">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                              Admin remarks
                            </p>
                            <p className="text-gray-700 mt-0.5 whitespace-pre-line">
                              {item.admin_remarks}
                            </p>
                          </div>
                        )}

                        {item.photo_url && (
                          <div className="pt-1">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                              Photo
                            </p>
                            <img
                              src={item.photo_url}
                              alt={item.goods_description || 'Goods photo'}
                              className="max-h-40 rounded-xl border border-gray-200 object-cover"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* SELECTION BAR — selection only; no shipment creation yet */}
        <div className="fixed bottom-0 inset-x-0 border-t border-gray-200 bg-white/95 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <p className="text-xs text-gray-600">
              {selectedCount === 0
                ? 'Select received goods to prepare a shipment.'
                : `${selectedCount} item${selectedCount === 1 ? '' : 's'} selected for shipment.`}
            </p>
            <button
              type="button"
              disabled
              className="text-xs font-bold px-4 py-2.5 rounded-xl bg-gray-200 text-gray-500 cursor-not-allowed"
              title="Shipment booking will be available once the backend workflow is ready"
            >
              Continue to shipment booking (coming soon)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
