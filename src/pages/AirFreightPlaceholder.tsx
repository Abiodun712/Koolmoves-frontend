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

  const [goods, setGoods] = useState<AirFreightGood[]>([]);
  const [nigeriaPickups, setNigeriaPickups] = useState<Warehouse[]>([]);
  const [airChinaWarehouse, setAirChinaWarehouse] = useState<Warehouse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickupWarehouseId, setPickupWarehouseId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copiedChinaAddress, setCopiedChinaAddress] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError(null);

      try {
        const { data: warehouseRows } = await supabase
          .from('warehouses')
          .select('*')
          .eq('is_active', true);

        if (cancelled) return;

        const warehouseById = new Map<string, Warehouse>();
        const warehouses = (warehouseRows || []).map((row) => {
          const warehouse = normalizeWarehouse(row);
          warehouseById.set(warehouse.id, warehouse);
          return warehouse;
        });

        // Air goods always use CN-AIR — users never choose the China warehouse.
        const chinaAir =
          warehouses.find((w) => w.code === 'CN-AIR' && isChinaReceivingWarehouse(w)) || null;
        setAirChinaWarehouse(chinaAir);

        setNigeriaPickups(
          warehouses.filter(
            (w) => isNigeriaPickupWarehouse(w) && warehouseSupportsFreight(w, 'air')
          )
        );

        if (!profile?.km_id) {
          setGoods([]);
          return;
        }

        const { data, error } = await supabase
          .from('air_freight_goods')
          .select('*')
          .eq('km_id', profile.km_id);

        if (cancelled) return;

        if (error) {
          setGoods([]);
          if (error.code !== 'PGRST116' && error.code !== '42P01') {
            setLoadError('Your Air goods could not be loaded right now.');
          }
          return;
        }

        const normalized = (data || [])
          .map((row) => normalizeGood(row, warehouseById))
          .filter((item) => item.freight_type === 'air');

        normalized.sort((a, b) => {
          const aTime = a.date_received ? new Date(a.date_received).getTime() : 0;
          const bTime = b.date_received ? new Date(b.date_received).getTime() : 0;
          return bTime - aTime;
        });

        setGoods(normalized);
      } catch {
        if (!cancelled) {
          setGoods([]);
          setLoadError('Your Air goods could not be loaded right now.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [profile?.km_id]);

  const copyChinaAddress = async () => {
    const text = airChinaWarehouse?.address?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedChinaAddress(true);
      window.setTimeout(() => setCopiedChinaAddress(false), 1500);
    } catch {
      // Clipboard may be blocked; leave UI unchanged.
    }
  };

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
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(goods.map((item) => item.id)));
    setSubmitMessage(null);
    setSubmitError(null);
  };

  const selectedCount = selectedIds.size;
  const selectedPickup = useMemo(
    () => nigeriaPickups.find((w) => w.id === pickupWarehouseId) || null,
    [nigeriaPickups, pickupWarehouseId]
  );

  const canRequestPacking =
    selectedCount > 0 &&
    Boolean(pickupWarehouseId) &&
    Boolean(user?.id) &&
    Boolean(profile?.km_id) &&
    !submitting;

  const requestPacking = async () => {
    setSubmitMessage(null);
    setSubmitError(null);

    if (!user?.id || !profile?.km_id) {
      setSubmitError('Sign in with a KM-ID to request packing.');
      return;
    }
    if (selectedCount === 0) {
      setSubmitError('Select at least one Air goods item.');
      return;
    }
    if (!selectedPickup || !warehouseSupportsFreight(selectedPickup, 'air')) {
      setSubmitError('Choose a Nigeria pickup warehouse that supports Air.');
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
            'Could not create packing request. Ensure warehouses.sql has been applied.'
        );
        return;
      }

      const { error: itemsError } = await supabase.from('air_packing_request_items').insert(
        selectedGoods.map((g) => ({
          request_id: requestRow.id,
          goods_id: g.id,
        }))
      );

      if (itemsError) {
        setSubmitError(
          itemsError.message ||
            'Packing request created, but goods items failed to save. Contact support.'
        );
        return;
      }

      setSubmitMessage(
        `Packing requested for ${selectedCount} item${selectedCount === 1 ? '' : 's'} · pickup: ${
          selectedPickup.name
        }.`
      );
      setSelectedIds(new Set());
      setPickupWarehouseId('');
    } catch (err: any) {
      setSubmitError(err?.message || 'Could not create packing request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto p-4 space-y-6 pb-52">
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Logistics
            </p>
            <h1 className="text-lg font-extrabold text-gray-900 mt-0.5">Air Freight</h1>
            <p className="text-xs text-gray-500 mt-0.5 max-w-xl leading-relaxed">
              Air goods are received at the Air China Warehouse (CN-AIR). Select items and request
              packing to a Nigeria pickup warehouse.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-gray-900 text-white px-3 py-1.5 rounded-xl text-xs font-bold">
              ID: {kmId}
            </div>
            <Link
              to="/home"
              className="text-xs font-bold text-emerald-600 hover:text-emerald-700 px-2 py-1.5"
            >
              ← Home
            </Link>
          </div>
        </div>

        {/* AIR CHINA RECEIVING WAREHOUSE (CN-AIR only — not selectable) */}
        <div className="bg-white p-5 rounded-2xl border border-emerald-200 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                China receiving warehouse
              </p>
              <h2 className="text-base font-extrabold text-[#0F172A] mt-0.5">
                {airChinaWarehouse?.name || 'Air China Warehouse'}
              </h2>
              <p className="text-xs text-gray-600 mt-1 font-semibold">
                Give this address to your China supplier.
              </p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Air goods automatically use CN-AIR. You do not choose the China warehouse.
              </p>
            </div>
            <button
              type="button"
              onClick={copyChinaAddress}
              disabled={!airChinaWarehouse?.address}
              className="shrink-0 text-xs font-bold px-4 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed"
            >
              {copiedChinaAddress ? 'Copied' : 'Copy Address'}
            </button>
          </div>
          {airChinaWarehouse?.address ? (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-sm text-gray-900 whitespace-pre-line leading-relaxed font-medium">
                {airChinaWarehouse.address}
              </p>
            </div>
          ) : (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              CN-AIR warehouse address is not available yet. Ensure warehouses are seeded in
              Supabase.
            </p>
          )}
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#0F172A]">Your Air goods</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Air goods for KM-ID <span className="font-bold text-gray-700">{kmId}</span>. Select
                items to request packing.
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
            <p className="text-xs text-gray-400">Loading your Air goods...</p>
          ) : loadError ? (
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800">
              {loadError}
            </div>
          ) : goods.length === 0 ? (
            <div className="p-6 text-center rounded-2xl border border-dashed border-gray-300 bg-slate-50 space-y-1">
              <p className="text-sm font-bold text-gray-800">No Air goods yet</p>
              <p className="text-xs text-gray-500">
                When admin records packages for your KM-ID at the Air China Warehouse, they will
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
                    className={`block p-4 rounded-2xl border transition-all cursor-pointer space-y-3 ${
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
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                              Description
                            </p>
                            <p className="text-sm font-bold text-gray-900 mt-0.5">
                              {item.goods_description || 'Untitled goods'}
                            </p>
                            <p className="text-[11px] text-gray-500 mt-1">
                              Date received: {formatDate(item.date_received)}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                            <span className="px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 uppercase">
                              air
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
                          {item.supplier_phone && (
                            <div className="p-2.5 rounded-xl bg-white border border-gray-100">
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                                Supplier phone
                              </p>
                              <p className="font-semibold text-gray-800 mt-0.5">
                                {item.supplier_phone}
                              </p>
                            </div>
                          )}
                          {item.tracking_number && (
                            <div className="p-2.5 rounded-xl bg-white border border-gray-100">
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                                Tracking number
                              </p>
                              <p className="font-semibold text-gray-800 mt-0.5 break-all">
                                {item.tracking_number}
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="p-2.5 rounded-xl bg-white border border-gray-100 text-xs">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                            Remarks
                          </p>
                          <p className="text-gray-700 mt-0.5 whitespace-pre-line">
                            {item.admin_remarks || '—'}
                          </p>
                        </div>

                        {item.photo_url && (
                          <div>
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
                disabled={!canRequestPacking}
                onClick={requestPacking}
                className="text-xs font-bold px-4 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed"
              >
                {submitting ? 'Submitting…' : 'Request Packing'}
              </button>
            </div>
            {selectedPickup && (
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Selected Nigeria pickup
                </p>
                <p className="text-sm font-bold text-gray-900">{selectedPickup.name}</p>
                {selectedPickup.address ? (
                  <p className="text-xs text-gray-800 whitespace-pre-line leading-relaxed">
                    {selectedPickup.address}
                  </p>
                ) : (
                  <p className="text-xs text-amber-700">Full address/phone not published yet.</p>
                )}
              </div>
            )}
            <p className="text-xs text-gray-600">
              {selectedCount === 0
                ? 'Select one or more Air goods, then choose a Nigeria pickup warehouse.'
                : `${selectedCount} item${selectedCount === 1 ? '' : 's'} selected for packing.`}
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
