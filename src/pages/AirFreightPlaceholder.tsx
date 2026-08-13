import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';
import {
  freightTypeFromReceivingWarehouse,
  isChinaReceivingWarehouse,
  isNigeriaPickupWarehouse,
  normalizeWarehouse,
  warehouseSupportsFreight,
  type FreightType,
  type Warehouse,
} from '../types/warehouse';

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
  china_warehouse_id: string | null;
  freight_type: FreightType;
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

function normalizeGood(
  row: Record<string, any>,
  warehouseById: Map<string, Warehouse>
): AirFreightGood {
  const chinaWarehouseId = row.china_warehouse_id ? String(row.china_warehouse_id) : null;
  const receiving = chinaWarehouseId ? warehouseById.get(chinaWarehouseId) : undefined;

  let freightType: FreightType = 'air';
  if (receiving && isChinaReceivingWarehouse(receiving)) {
    try {
      freightType = freightTypeFromReceivingWarehouse(receiving);
    } catch {
      freightType = 'air';
    }
  }

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
    china_warehouse_id: chinaWarehouseId,
    freight_type: freightType,
  };
}

export default function AirFreightPlaceholder() {
  const { user, profile } = useAuth();
  const kmId = profile?.km_id || 'Loading...';

  const [fees, setFees] = useState<AirFreightFees>({
    ratePerKg: null,
    feeNote: null,
  });
  const [airChinaWarehouse, setAirChinaWarehouse] = useState<Warehouse | null>(null);
  const [nigeriaPickups, setNigeriaPickups] = useState<Warehouse[]>([]);
  const [legacyChinaAddress, setLegacyChinaAddress] = useState<string | null>(null);
  const [goods, setGoods] = useState<AirFreightGood[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickupWarehouseId, setPickupWarehouseId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
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
        const [{ data: settingsRows }, { data: warehouseRows, error: warehouseError }] =
          await Promise.all([
            supabase
              .from('site_settings')
              .select('key, value')
              .in('key', [
                'china_warehouse_address',
                'air_freight_rate_per_kg',
                'air_freight_fee',
                'air_freight_fee_info',
                'air_freight_info',
              ]),
            supabase.from('warehouses').select('*').eq('is_active', true),
          ]);

        if (cancelled) return;

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
        setLegacyChinaAddress(pickSetting(settingsRows, ['china_warehouse_address']));

        const warehouseById = new Map<string, Warehouse>();
        const warehouses = (warehouseRows || []).map((row) => {
          const warehouse = normalizeWarehouse(row);
          warehouseById.set(warehouse.id, warehouse);
          return warehouse;
        });

        if (warehouseError) {
          setAirChinaWarehouse(null);
          setNigeriaPickups([]);
        } else {
          const chinaAir =
            warehouses.find(
              (w) =>
                isChinaReceivingWarehouse(w) &&
                w.freight_type === 'air' &&
                (w.code === 'CN-AIR' || warehouseSupportsFreight(w, 'air'))
            ) || null;
          setAirChinaWarehouse(chinaAir);

          setNigeriaPickups(
            warehouses.filter(
              (w) => isNigeriaPickupWarehouse(w) && warehouseSupportsFreight(w, 'air')
            )
          );
        }

        if (!user?.id && !profile?.km_id) {
          setGoods([]);
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
          setGoods([]);
          if (error.code !== 'PGRST116' && error.code !== '42P01') {
            setLoadError('Received goods could not be loaded right now.');
          }
        } else {
          const normalized = (data || [])
            .map((row) => normalizeGood(row, warehouseById))
            // Air page: only AIR goods (freight from China receiving warehouse)
            .filter((item) => item.freight_type === 'air');
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
    setSubmitMessage(null);
    setSubmitError(null);
  };

  const allSelected = goods.length > 0 && selectedIds.size === goods.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(goods.map((item) => item.id)));
    setSubmitMessage(null);
    setSubmitError(null);
  };

  const selectedCount = selectedIds.size;
  const canCopyKmId = Boolean(profile?.km_id);
  const hasPublishedFees = Boolean(fees.ratePerKg || fees.feeNote);
  const chinaAddress = airChinaWarehouse?.address || legacyChinaAddress;
  const selectedPickup = useMemo(
    () => nigeriaPickups.find((w) => w.id === pickupWarehouseId) || null,
    [nigeriaPickups, pickupWarehouseId]
  );

  const canSubmitPacking =
    selectedCount > 0 &&
    Boolean(pickupWarehouseId) &&
    Boolean(user?.id) &&
    Boolean(profile?.km_id) &&
    !submitting;

  const submitForPacking = async () => {
    setSubmitMessage(null);
    setSubmitError(null);

    if (!user?.id || !profile?.km_id) {
      setSubmitError('Sign in with a KM ID to submit goods for packing.');
      return;
    }
    if (selectedCount === 0) {
      setSubmitError('Select at least one received goods item.');
      return;
    }
    if (!selectedPickup || !warehouseSupportsFreight(selectedPickup, 'air')) {
      setSubmitError('Choose an eligible Nigeria pickup warehouse that supports Air.');
      return;
    }

    const selectedGoods = goods.filter((g) => selectedIds.has(g.id));
    const chinaWarehouseId =
      selectedGoods.find((g) => g.china_warehouse_id)?.china_warehouse_id ||
      airChinaWarehouse?.id ||
      null;

    setSubmitting(true);
    try {
      const { data: requestRow, error: requestError } = await supabase
        .from('packing_requests')
        .insert({
          user_id: user.id,
          km_id: profile.km_id,
          freight_type: 'air',
          china_warehouse_id: chinaWarehouseId,
          nigeria_pickup_warehouse_id: selectedPickup.id,
          status: 'pending_packing',
        })
        .select('id')
        .single();

      if (requestError || !requestRow?.id) {
        setSubmitError(
          requestError?.message ||
            'Could not save packing request. Run supabase/warehouses.sql if tables are missing.'
        );
        return;
      }

      const items = selectedGoods.map((g) => ({
        request_id: requestRow.id,
        goods_id: g.id,
      }));

      const { error: itemsError } = await supabase
        .from('air_packing_request_items')
        .insert(items);

      if (itemsError) {
        setSubmitError(
          itemsError.message ||
            'Packing request created, but goods items failed to save. Contact support.'
        );
        return;
      }

      setSubmitMessage(
        `Submitted ${selectedCount} item${selectedCount === 1 ? '' : 's'} for packing to ${
          selectedPickup.name
        }. Pickup warehouse is stored with this request.`
      );
      setSelectedIds(new Set());
      setPickupWarehouseId('');
    } catch (err: any) {
      setSubmitError(err?.message || 'Could not submit packing request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto p-4 space-y-6 pb-36">
        {/* HEADER */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Logistics
            </p>
            <h1 className="text-lg font-extrabold text-gray-900 mt-0.5">Air Freight</h1>
            <p className="text-xs text-gray-500 mt-0.5 max-w-xl leading-relaxed">
              Goods received at the Air China Warehouse are automatically AIR. You never choose
              Air or Sea — only select an eligible Nigeria pickup when submitting for packing.
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
            <strong className="font-extrabold">Exchange</strong> service (Naira ↔ RMB).
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
            the <strong className="font-extrabold">Air China Warehouse</strong>. Goods without a KM
            ID may be delayed or cannot be matched to your account.
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

        {/* FEES / INFO */}
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
              Air Freight fees have not been published by admin yet.
            </p>
          )}
        </div>

        {/* CHINA RECEIVING WAREHOUSE */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#0F172A]">
                {airChinaWarehouse?.name || 'Air China Warehouse'}
              </h2>
              <p className="text-xs text-gray-500">
                China receiving warehouse · Freight type{' '}
                <span className="font-bold text-emerald-700">AIR</span> (automatic)
              </p>
            </div>
            {chinaAddress && (
              <button
                type="button"
                onClick={() => copyText('china-address', chinaAddress)}
                className="shrink-0 text-[11px] font-bold text-emerald-600 hover:text-emerald-700"
              >
                {copiedKey === 'china-address' ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          {chinaAddress ? (
            <p className="text-sm text-gray-800 whitespace-pre-line leading-relaxed pt-1">
              {chinaAddress}
            </p>
          ) : (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
              Air China Warehouse address has not been published yet. Run supabase/warehouses.sql
              and update the CN-AIR address.
            </p>
          )}
        </div>

        {/* NIGERIA PICKUP WAREHOUSES (Air-eligible) */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-3">
          <div>
            <h2 className="text-sm font-bold text-[#0F172A]">Nigeria pickup warehouses</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Multiple pickups may be available. Only warehouses that support Air are listed here.
              You choose one when submitting goods for packing.
            </p>
          </div>
          {nigeriaPickups.length === 0 ? (
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl p-3">
              No Air-eligible Nigeria pickup warehouses are published yet. Run
              supabase/warehouses.sql to seed them.
            </p>
          ) : (
            <div className="space-y-2">
              {nigeriaPickups.map((warehouse) => (
                <div
                  key={warehouse.id}
                  className="p-3 rounded-xl border border-gray-200 bg-slate-50 space-y-1"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-gray-900">{warehouse.name}</p>
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg bg-white border border-gray-200 text-gray-600">
                      Supports {warehouse.freight_type}
                    </span>
                  </div>
                  {warehouse.address && (
                    <p className="text-xs text-gray-700 whitespace-pre-line">{warehouse.address}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RECEIVED GOODS */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#0F172A]">Received Air Freight Goods</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Read-only. Freight type is AIR because these goods were received at the Air China
                Warehouse.
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
                When your packages arrive at the Air China Warehouse and are logged by admin, they
                will appear here as AIR goods.
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
                            <span className="px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 uppercase">
                              {item.freight_type}
                            </span>
                            <span className="px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-700">
                              Qty:{' '}
                              {item.quantity != null && !Number.isNaN(item.quantity)
                                ? item.quantity
                                : '—'}
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

        {/* SELECTION + NIGERIA PICKUP + SUBMIT */}
        <div className="fixed bottom-0 inset-x-0 border-t border-gray-200 bg-white/95 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto px-4 py-3 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
              <label className="flex-1 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                  Nigeria pickup warehouse (required)
                </span>
                <select
                  value={pickupWarehouseId}
                  onChange={(e) => {
                    setPickupWarehouseId(e.target.value);
                    setSubmitMessage(null);
                    setSubmitError(null);
                  }}
                  disabled={selectedCount === 0 || nigeriaPickups.length === 0}
                  className="w-full text-xs font-semibold px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-800 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="">
                    {selectedCount === 0
                      ? 'Select goods first…'
                      : nigeriaPickups.length === 0
                        ? 'No Air-eligible pickups available'
                        : 'Choose Nigeria pickup…'}
                  </option>
                  {nigeriaPickups.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name} ({warehouse.freight_type})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!canSubmitPacking}
                onClick={submitForPacking}
                className="text-xs font-bold px-4 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed"
                title="Stores selected goods with the chosen Nigeria pickup warehouse"
              >
                {submitting ? 'Submitting…' : 'Submit for packing'}
              </button>
            </div>
            <p className="text-xs text-gray-600">
              {selectedCount === 0
                ? 'Select received AIR goods, then choose an eligible Nigeria pickup warehouse.'
                : `${selectedCount} item${selectedCount === 1 ? '' : 's'} selected · freight AIR (from Air China Warehouse).`}
            </p>
            {submitError && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                {submitError}
              </p>
            )}
            {submitMessage && (
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                {submitMessage}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
