import React, { useEffect, useMemo, useState } from 'react';
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
import {
  AIR_USER_PROGRESS_STEPS,
  airShipmentRevealsPickupAddress,
  airShipmentStatusLabel,
  airUserProgressIndex,
  normalizeLogisticsShipment,
  type LogisticsShipment,
} from '../types/shipment';
import {
  LOGISTICS_RECEIPT_BUCKET,
  logisticsPaymentStatusLabel,
  normalizeLogisticsPayment,
  userMaySubmitLogisticsPayment,
  type LogisticsPayment,
} from '../types/logisticsPayment';
import { computeLogisticsStorage } from '../lib/logisticsStorage';
import { storedFeeToInput } from '../lib/logisticsSettings';

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
  packingRequested: boolean;
};

type ShipmentGood = {
  id: string;
  goods_description: string | null;
  quantity: number | null;
  weight_kg: number | null;
  supplier_phone: string | null;
  tracking_number: string | null;
  photo_url: string | null;
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

function formatNaira(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—';
  return `₦${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function normalizeGood(
  row: Record<string, any>,
  warehouseById: Map<string, Warehouse>,
  requestedIds: Set<string>
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
    packingRequested: requestedIds.has(String(row.id)),
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
  const [airFreightFee, setAirFreightFee] = useState<string | null>(null);
  const [airFreightNotice, setAirFreightNotice] = useState<string | null>(null);
  const [storageFeePerDay, setStorageFeePerDay] = useState<number | null>(null);
  const [packingInstructions, setPackingInstructions] = useState('');
  const [shipments, setShipments] = useState<LogisticsShipment[]>([]);
  const [shipmentGoodsById, setShipmentGoodsById] = useState<Record<string, ShipmentGood[]>>({});
  const [paymentByShipmentId, setPaymentByShipmentId] = useState<Record<string, LogisticsPayment>>(
    {}
  );
  const [receiptUrlByShipmentId, setReceiptUrlByShipmentId] = useState<Record<string, string>>({});
  const [uploadingPaymentId, setUploadingPaymentId] = useState<string | null>(null);
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [warehouseById, setWarehouseById] = useState<Map<string, Warehouse>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError(null);

      try {
        const [{ data: warehouseRows }, { data: settingsRows }] = await Promise.all([
          supabase.from('warehouses').select('*').eq('is_active', true),
          supabase
            .from('site_settings')
            .select('key, value')
            .in('key', ['air_freight_fee', 'air_freight_notice', 'storage_fee_per_day']),
        ]);

        if (cancelled) return;

        if (settingsRows) {
          const map: Record<string, string> = {};
          settingsRows.forEach((row: { key: string; value: string }) => {
            map[row.key] = row.value ?? '';
          });
          setAirFreightFee(map.air_freight_fee?.trim() || null);
          setAirFreightNotice(map.air_freight_notice?.trim() || null);
          const storageRaw = storedFeeToInput(map.storage_fee_per_day);
          const storageNum = Number(storageRaw);
          setStorageFeePerDay(Number.isFinite(storageNum) && storageNum >= 0 ? storageNum : null);
        }

        const nextWarehouseById = new Map<string, Warehouse>();
        const warehouses = (warehouseRows || []).map((row) => {
          const warehouse = normalizeWarehouse(row);
          nextWarehouseById.set(warehouse.id, warehouse);
          return warehouse;
        });
        setWarehouseById(nextWarehouseById);

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
          setShipments([]);
          setShipmentGoodsById({});
          setPaymentByShipmentId({});
          setReceiptUrlByShipmentId({});
          return;
        }

        const packingRequestsQuery = user?.id
          ? supabase
              .from('packing_requests')
              .select('id')
              .eq('user_id', user.id)
              .eq('freight_type', 'air')
          : Promise.resolve({ data: [] as { id: string }[] });

        const [{ data, error }, { data: requestRows }, { data: shipmentRows }] = await Promise.all([
          supabase.from('air_freight_goods').select('*').eq('km_id', profile.km_id),
          packingRequestsQuery,
          supabase
            .from('shipments')
            .select('*')
            .eq('km_id', profile.km_id)
            .eq('freight_type', 'air')
            .order('created_at', { ascending: false }),
        ]);

        if (cancelled) return;

        const normalizedShipments = (shipmentRows || []).map((row) =>
          normalizeLogisticsShipment(row)
        );
        setShipments(normalizedShipments);

        const shipmentIds = normalizedShipments.map((s) => s.id);
        const nextGoodsByShipment: Record<string, ShipmentGood[]> = {};
        const shipmentUsedGoodsIds = new Set<string>();
        shipmentIds.forEach((id) => {
          nextGoodsByShipment[id] = [];
        });

        if (shipmentIds.length > 0) {
          const { data: itemRows } = await supabase
            .from('air_shipment_items')
            .select('shipment_id, goods_id')
            .in('shipment_id', shipmentIds);

          const goodsIds = Array.from(
            new Set((itemRows || []).map((row: { goods_id: string }) => String(row.goods_id)))
          );
          goodsIds.forEach((id) => shipmentUsedGoodsIds.add(id));

          const goodsById = new Map<string, ShipmentGood>();
          if (goodsIds.length > 0) {
            const { data: goodsRows } = await supabase
              .from('air_freight_goods')
              .select(
                'id, goods_description, quantity, weight_kg, supplier_phone, tracking_number, photo_url'
              )
              .in('id', goodsIds);

            (goodsRows || []).forEach((row: Record<string, any>) => {
              goodsById.set(String(row.id), {
                id: String(row.id),
                goods_description: row.goods_description ?? null,
                quantity: row.quantity != null ? Number(row.quantity) : null,
                weight_kg: row.weight_kg != null ? Number(row.weight_kg) : null,
                supplier_phone: row.supplier_phone ?? null,
                tracking_number: row.tracking_number ?? null,
                photo_url: row.photo_url ?? null,
              });
            });
          }

          (itemRows || []).forEach((row: { shipment_id: string; goods_id: string }) => {
            const sid = String(row.shipment_id);
            const good = goodsById.get(String(row.goods_id));
            if (!good) return;
            const list = nextGoodsByShipment[sid] || [];
            list.push(good);
            nextGoodsByShipment[sid] = list;
          });
        }

        if (!cancelled) setShipmentGoodsById(nextGoodsByShipment);

        const nextPayments: Record<string, LogisticsPayment> = {};
        const nextReceiptUrls: Record<string, string> = {};
        if (shipmentIds.length > 0) {
          const { data: payRows, error: payErr } = await supabase
            .from('logistics_payments')
            .select('*')
            .in('shipment_id', shipmentIds);

          if (!payErr && payRows) {
            payRows.forEach((row) => {
              const payment = normalizeLogisticsPayment(row);
              nextPayments[payment.shipment_id] = payment;
            });
            await Promise.all(
              Object.values(nextPayments).map(async (payment) => {
                if (!payment.receipt_path) return;
                const { data: signed } = await supabase.storage
                  .from(LOGISTICS_RECEIPT_BUCKET)
                  .createSignedUrl(payment.receipt_path, 3600);
                if (signed?.signedUrl) nextReceiptUrls[payment.shipment_id] = signed.signedUrl;
              })
            );
          }
        }
        if (!cancelled) {
          setPaymentByShipmentId(nextPayments);
          setReceiptUrlByShipmentId(nextReceiptUrls);
        }

        if (error) {
          setGoods([]);
          if (error.code !== 'PGRST116' && error.code !== '42P01') {
            setLoadError('Your Air goods could not be loaded right now.');
          }
          return;
        }

        const requestedIds = new Set<string>(shipmentUsedGoodsIds);
        const requestIds = (requestRows || []).map((r: { id: string }) => String(r.id));
        if (requestIds.length > 0) {
          const { data: packingItemRows } = await supabase
            .from('air_packing_request_items')
            .select('goods_id')
            .in('request_id', requestIds);
          (packingItemRows || []).forEach((row: { goods_id: string }) => {
            requestedIds.add(String(row.goods_id));
          });
        }

        const normalized = (data || [])
          .map((row) => normalizeGood(row, nextWarehouseById, requestedIds))
          .filter((item) => item.freight_type === 'air');

        normalized.sort((a, b) => {
          const aTime = a.date_received ? new Date(a.date_received).getTime() : 0;
          const bTime = b.date_received ? new Date(b.date_received).getTime() : 0;
          return bTime - aTime;
        });

        setGoods(normalized);
        setSelectedIds((prev) => {
          const allowed = new Set(
            normalized.filter((item) => !item.packingRequested).map((item) => item.id)
          );
          const next = new Set<string>();
          prev.forEach((id) => {
            if (allowed.has(id)) next.add(id);
          });
          return next;
        });
      } catch {
        if (!cancelled) {
          setGoods([]);
          setShipments([]);
          setShipmentGoodsById({});
          setPaymentByShipmentId({});
          setReceiptUrlByShipmentId({});
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
  }, [profile?.km_id, user?.id, reloadTick]);

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

  const selectGood = (id: string) => {
    const item = goods.find((g) => g.id === id);
    if (!item || item.packingRequested) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setSubmitMessage(null);
    setSubmitError(null);
  };

  const removeSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSubmitMessage(null);
    setSubmitError(null);
  };

  const unrequestedGoods = useMemo(
    () => goods.filter((item) => !item.packingRequested),
    [goods]
  );
  const availableGoods = useMemo(
    () => unrequestedGoods.filter((item) => !selectedIds.has(item.id)),
    [unrequestedGoods, selectedIds]
  );
  const selectedGoodsList = useMemo(
    () => unrequestedGoods.filter((item) => selectedIds.has(item.id)),
    [unrequestedGoods, selectedIds]
  );
  const requestedCount = goods.length - unrequestedGoods.length;

  const allSelected =
    unrequestedGoods.length > 0 && selectedIds.size === unrequestedGoods.length;

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(unrequestedGoods.map((item) => item.id)));
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

    const selectedGoods = goods.filter((g) => selectedIds.has(g.id) && !g.packingRequested);
    const chinaWarehouseId =
      selectedGoods.find((g) => g.china_warehouse_id)?.china_warehouse_id ||
      airChinaWarehouse?.id ||
      null;

    setSubmitting(true);
    let createdRequestId: string | null = null;
    try {
      const { data: requestRow, error: requestError } = await supabase
        .from('packing_requests')
        .insert({
          user_id: user.id,
          km_id: profile.km_id,
          freight_type: 'air',
          china_warehouse_id: chinaWarehouseId,
          nigeria_pickup_warehouse_id: selectedPickup.id,
          user_packing_instructions: packingInstructions.trim() || null,
          status: 'pending_packing',
        })
        .select('id')
        .single();

      if (requestError || !requestRow?.id) {
        setSubmitError(
          requestError?.message ||
            'Could not create packing request. Ensure warehouses.sql and shipments.sql have been applied.'
        );
        return;
      }

      createdRequestId = requestRow.id;

      const { data: itemRows, error: itemsError } = await supabase
        .from('air_packing_request_items')
        .insert(
          selectedGoods.map((g) => ({
            request_id: requestRow.id,
            goods_id: g.id,
          }))
        )
        .select('goods_id');

      const savedIds = new Set(
        (itemRows || []).map((row: { goods_id: string }) => String(row.goods_id))
      );
      const allItemsSaved =
        !itemsError &&
        savedIds.size === selectedGoods.length &&
        selectedGoods.every((g) => savedIds.has(g.id));

      if (!allItemsSaved) {
        await supabase.from('packing_requests').delete().eq('id', createdRequestId);
        createdRequestId = null;
        setSubmitError(
          itemsError?.message ||
            'Packing request created, but goods items failed to save. Contact support.'
        );
        return;
      }

      createdRequestId = null;
      setSubmitMessage(
        `Packing requested for ${selectedCount} item${selectedCount === 1 ? '' : 's'} · pickup: ${
          selectedPickup.name
        }.`
      );
      setSelectedIds(new Set());
      setPickupWarehouseId('');
      setPackingInstructions('');
      setGoods((prev) =>
        prev.map((g) =>
          selectedGoods.some((s) => s.id === g.id) ? { ...g, packingRequested: true } : g
        )
      );
      setReloadTick((n) => n + 1);
    } catch (err: any) {
      if (createdRequestId) {
        await supabase.from('packing_requests').delete().eq('id', createdRequestId);
      }
      setSubmitError(err?.message || 'Could not create packing request.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitLogisticsPayment = async (shipment: LogisticsShipment, file: File) => {
    setPaymentNotice(null);
    setPaymentError(null);

    if (!user?.id) {
      setPaymentError('Sign in to upload a payment receipt.');
      return;
    }
    if (shipment.status !== 'ready_for_pickup') {
      setPaymentError('Payment upload is available when the shipment is available for pickup.');
      return;
    }
    const existing = paymentByShipmentId[shipment.id] || null;
    if (!userMaySubmitLogisticsPayment(existing)) {
      setPaymentError('A receipt is already submitted and awaiting confirmation.');
      return;
    }

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${user.id}/${shipment.id}/${Date.now()}.${ext || 'jpg'}`;

    setUploadingPaymentId(shipment.id);
    try {
      const { error: uploadError } = await supabase.storage
        .from(LOGISTICS_RECEIPT_BUCKET)
        .upload(path, file, { upsert: false });
      if (uploadError) {
        setPaymentError(uploadError.message || 'Receipt upload failed.');
        return;
      }

      const now = new Date().toISOString();
      const payload = {
        shipment_id: shipment.id,
        user_id: user.id,
        status: 'submitted' as const,
        receipt_path: path,
        submitted_at: now,
        submitted_by: user.id,
        confirmed_at: null,
        rejected_at: null,
        rejection_note: null,
        reviewed_by: null,
        updated_at: now,
      };

      if (existing) {
        const { error: updErr } = await supabase
          .from('logistics_payments')
          .update(payload)
          .eq('id', existing.id)
          .eq('user_id', user.id)
          .in('status', ['pending', 'rejected']);
        if (updErr) {
          setPaymentError(updErr.message || 'Could not save payment record.');
          return;
        }
      } else {
        const { error: insErr } = await supabase.from('logistics_payments').insert(payload);
        if (insErr) {
          setPaymentError(
            insErr.message ||
              'Could not save payment record. Apply supabase/logistics_payments.sql in Supabase.'
          );
          return;
        }
      }

      setPaymentNotice('Receipt submitted. Awaiting admin confirmation.');
      setReloadTick((n) => n + 1);
    } catch (err: any) {
      setPaymentError(err?.message || 'Could not submit payment receipt.');
    } finally {
      setUploadingPaymentId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto p-4 space-y-6 pb-72">
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Logistics
          </p>
          <h1 className="text-lg font-extrabold text-gray-900 mt-0.5">Air Freight</h1>
          <p className="text-xs text-gray-500 mt-0.5 max-w-xl leading-relaxed">
            Air goods are received at the Air China Warehouse (CN-AIR). Select items and request
            packing to a Nigeria pickup warehouse.
          </p>
        </div>

        {/* FEE + ADMIN NOTICE (site_settings) */}
        <div className="bg-white p-5 rounded-2xl border border-amber-200 shadow-sm space-y-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">
              Current Air Freight fee
            </p>
            <p className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] mt-1 tracking-tight">
              {airFreightFee || 'Not published yet'}
            </p>
          </div>
          {airFreightNotice ? (
            <div className="pt-3 border-t border-amber-100">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Latest notice
              </p>
              <p className="text-sm text-gray-800 mt-1 whitespace-pre-line leading-relaxed">
                {airFreightNotice}
              </p>
            </div>
          ) : null}
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

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-4 overflow-x-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#0F172A]">Your Air goods</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Air goods for KM-ID <span className="font-bold text-gray-700">{kmId}</span>. Add
                items to Selected Goods, then request packing.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {unrequestedGoods.length > 0 && !loading && !loadError && (
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="text-xs font-bold text-emerald-600 hover:text-emerald-700 min-h-[44px] px-3 py-2"
                >
                  {allSelected ? 'Clear selection' : 'Select all available'}
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
            <div className="space-y-5">
              {requestedCount > 0 ? (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  {requestedCount} item{requestedCount === 1 ? '' : 's'} already included in a
                  packing request and hidden from this list.
                </p>
              ) : null}

              <div className="space-y-3">
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-600">
                    Available goods
                  </h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Goods you can add to this packing request.
                  </p>
                </div>
                {availableGoods.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-gray-300 bg-slate-50 text-xs text-gray-600">
                    {unrequestedGoods.length === 0
                      ? 'No Air goods are available for a new packing request.'
                      : 'All remaining goods are in Selected Goods below.'}
                  </div>
                ) : (
                  availableGoods.map((item) => (
                    <div
                      key={item.id}
                      className="p-4 rounded-2xl border border-gray-200 bg-[#F8FAFC] space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                            Description
                          </p>
                          <p className="text-sm font-bold text-gray-900 mt-0.5 break-words">
                            {item.goods_description || 'Untitled goods'}
                          </p>
                          <p className="text-[11px] text-gray-500 mt-1">
                            Date received: {formatDate(item.date_received)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => selectGood(item.id)}
                          className="shrink-0 min-h-[44px] px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500"
                        >
                          Add
                        </button>
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
                        {item.tracking_number ? (
                          <span className="px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-700 break-all">
                            Tracking: {item.tracking_number}
                          </span>
                        ) : null}
                      </div>
                      {item.photo_url ? (
                        <img
                          src={item.photo_url}
                          alt={item.goods_description || 'Goods photo'}
                          className="max-h-40 rounded-xl border border-gray-200 object-cover"
                        />
                      ) : null}
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wide text-emerald-800">
                    Selected Goods
                  </h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    These items will be included when you request packing. Remove one to return it
                    to Available goods.
                  </p>
                </div>
                {selectedGoodsList.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 text-xs text-gray-600">
                    No goods selected yet. Add items from Available goods.
                  </div>
                ) : (
                  selectedGoodsList.map((item) => (
                    <div
                      key={item.id}
                      className="p-4 rounded-2xl border border-emerald-300 bg-emerald-50/40 space-y-2"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-gray-900 break-words">
                            {item.goods_description || 'Untitled goods'}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold">
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
                            {item.tracking_number ? (
                              <span className="px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-700 break-all">
                                Tracking: {item.tracking_number}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeSelected(item.id)}
                          className="shrink-0 min-h-[44px] px-4 rounded-xl border border-gray-300 bg-white text-gray-800 text-xs font-bold hover:bg-gray-50"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {shipments.length > 0 && (
          <div className="bg-white p-5 rounded-2xl border border-emerald-200 shadow-sm space-y-4">
            <div>
              <h2 className="text-sm font-bold text-[#0F172A]">Your Air shipments</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                After admin finalizes a package, the full Nigeria pickup warehouse address is shown
                here (not just the area name).
              </p>
            </div>
            {paymentError ? (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                {paymentError}
              </p>
            ) : null}
            {paymentNotice ? (
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                {paymentNotice}
              </p>
            ) : null}
            {shipments.map((shipment) => {
                const pickup = warehouseById.get(shipment.nigeria_pickup_warehouse_id);
                const showFullAddress = airShipmentRevealsPickupAddress(shipment);
                const progressIndex = airUserProgressIndex(shipment.status);
                const includedGoods = shipmentGoodsById[shipment.id] || [];
                const payment = paymentByShipmentId[shipment.id] || null;
                const receiptUrl = receiptUrlByShipmentId[shipment.id] || null;
                const storage = computeLogisticsStorage({
                  estimatedArrival: shipment.estimated_arrival,
                  status: shipment.status,
                  updatedAt: shipment.updated_at,
                  storageFeePerDay,
                });
                return (
                  <div
                    key={shipment.id}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          Shipment ID
                        </p>
                        <p className="text-sm font-extrabold text-gray-900">
                          {shipment.shipment_code}
                        </p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-700">
                        {airShipmentStatusLabel(shipment.status)}
                      </span>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">
                        Progress
                      </p>
                      <div className="grid grid-cols-4 gap-1">
                        {AIR_USER_PROGRESS_STEPS.map((step, index) => {
                          const reached = progressIndex >= index;
                          const current = progressIndex === index;
                          return (
                            <div key={step.status} className="min-w-0">
                              <div
                                className={`h-1.5 rounded-full ${
                                  reached ? 'bg-emerald-600' : 'bg-slate-200'
                                }`}
                              />
                              <p
                                className={`mt-1 text-[10px] font-bold leading-tight ${
                                  current
                                    ? 'text-emerald-800'
                                    : reached
                                      ? 'text-emerald-700'
                                      : 'text-slate-400'
                                }`}
                              >
                                {step.label}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Departure</p>
                        <p className="font-semibold text-gray-800">
                          {formatDate(shipment.departure_date)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase">ETA</p>
                        <p className="font-semibold text-gray-800">
                          {formatDate(shipment.estimated_arrival)}
                        </p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">
                          Total packed weight
                        </p>
                        <p className="font-semibold text-gray-800">
                          {shipment.final_packed_weight_kg != null
                            ? `${shipment.final_packed_weight_kg} kg`
                            : '—'}
                        </p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-200 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        Goods in this shipment
                      </p>
                      {includedGoods.length === 0 ? (
                        <p className="text-xs text-gray-500">No goods linked to this shipment.</p>
                      ) : (
                        <ul className="space-y-2">
                          {includedGoods.map((good) => (
                            <li
                              key={good.id}
                              className="p-3 rounded-xl bg-white border border-slate-200 space-y-1"
                            >
                              <p className="text-xs font-bold text-gray-900">
                                {good.goods_description || 'Untitled goods'}
                              </p>
                              <p className="text-[11px] text-gray-600">
                                Qty {good.quantity ?? '—'} ·{' '}
                                {good.weight_kg != null ? `${good.weight_kg} kg` : '— kg'}
                              </p>
                              {good.supplier_phone ? (
                                <p className="text-[11px] text-gray-600">
                                  Supplier phone: {good.supplier_phone}
                                </p>
                              ) : null}
                              {good.tracking_number ? (
                                <p className="text-[11px] text-gray-600 break-all">
                                  Tracking: {good.tracking_number}
                                </p>
                              ) : null}
                              {good.photo_url ? (
                                <img
                                  src={good.photo_url}
                                  alt={good.goods_description || 'Goods photo'}
                                  className="mt-1 max-h-28 rounded-lg border border-gray-200 object-cover"
                                />
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-200 space-y-1 text-xs">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        Cost breakdown
                      </p>
                      <p className="text-gray-700">
                        Freight charge:{' '}
                        <span className="font-semibold">{formatNaira(shipment.freight_charge)}</span>
                      </p>
                      <p className="text-gray-700">
                        Packing fee:{' '}
                        <span className="font-semibold">{formatNaira(shipment.packing_fee)}</span>
                      </p>
                      <p className="text-gray-700">
                        Clearing / landing cost:{' '}
                        <span className="font-semibold">{formatNaira(shipment.landing_cost)}</span>
                      </p>
                      <p className="font-extrabold text-gray-900">
                        Total amount due: {formatNaira(shipment.total_amount_due)}
                      </p>
                    </div>

                    {storage ? (
                      <div className="pt-2 border-t border-slate-200 space-y-1 text-xs">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-cyan-800">
                          Nigeria storage
                        </p>
                        <p className="text-gray-700">
                          Arrival date:{' '}
                          <span className="font-semibold">
                            {storage.arrivalDate ? formatDate(storage.arrivalDate) : 'Not set'}
                          </span>
                        </p>
                        <p className="text-gray-700">
                          Free storage: {storage.freeStorageDays} days
                        </p>
                        <p className="text-gray-700">Days elapsed: {storage.daysElapsed}</p>
                        <p className="text-gray-700">
                          Chargeable storage days: {storage.chargeableDays}
                        </p>
                        <p className="text-gray-700">
                          Storage fee per day: {formatNaira(storage.storageFeePerDay)}
                        </p>
                        <p className="font-extrabold text-gray-900">
                          Current storage charge: {formatNaira(storage.storageCharge)}
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {storage.accumulating
                            ? 'The first 14 calendar days after arrival are free. Charges begin on day 15. This charge is not added to the shipment total above.'
                            : 'Completed / picked up — storage is no longer accumulating.'}
                        </p>
                      </div>
                    ) : null}

                    {showFullAddress ? (
                      <div className="pt-2 border-t border-slate-200 space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                          Nigeria pickup — full address
                        </p>
                        <p className="text-sm font-bold text-gray-900">
                          {pickup?.name || 'Pickup warehouse'}
                        </p>
                        {pickup?.address ? (
                          <p className="text-sm text-gray-900 whitespace-pre-line leading-relaxed font-medium">
                            {pickup.address}
                          </p>
                        ) : (
                          <p className="text-xs text-amber-700">
                            Full address not published on this warehouse yet.
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500">
                        Full pickup address appears after admin finalizes this shipment.
                      </p>
                    )}

                    {shipment.status === 'completed' ? (
                      <div className="pt-2 border-t border-slate-200 space-y-2">
                        <p className="text-sm font-extrabold text-emerald-800">
                          Completed / Picked Up
                        </p>
                        <p className="text-xs text-gray-600">
                          This shipment has been marked picked up. You cannot mark it completed
                          yourself.
                        </p>
                      </div>
                    ) : shipment.status === 'ready_for_pickup' ? (
                      <div className="pt-2 border-t border-slate-200 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800">
                          Payment
                        </p>
                        <p className="text-xs font-extrabold text-gray-900">
                          Amount due: {formatNaira(shipment.total_amount_due)}
                        </p>
                        <p className="text-xs font-semibold text-gray-800">
                          Status:{' '}
                          {payment
                            ? logisticsPaymentStatusLabel(payment.status)
                            : 'Payment required'}
                        </p>
                        {payment?.status === 'confirmed' ? (
                          <div className="space-y-1">
                            <p className="text-sm font-extrabold text-emerald-800">
                              Payment Confirmed
                            </p>
                            <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                              This shipment is ready for pickup.
                            </p>
                          </div>
                        ) : (
                          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                            Payment confirmation is required before pickup.
                          </p>
                        )}
                        {payment?.status === 'rejected' && payment.rejection_note ? (
                          <p className="text-xs text-rose-700">
                            Rejection note: {payment.rejection_note}
                          </p>
                        ) : null}
                        {receiptUrl ? (
                          <a
                            href={receiptUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-bold text-emerald-700 underline"
                          >
                            View submitted receipt
                          </a>
                        ) : null}
                        {userMaySubmitLogisticsPayment(payment) ? (
                          <label className="block space-y-1">
                            <span className="text-[10px] font-bold uppercase text-gray-500">
                              {payment?.status === 'rejected'
                                ? 'Upload a replacement receipt'
                                : 'Upload payment receipt'}
                            </span>
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              disabled={uploadingPaymentId === shipment.id}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (file) void submitLogisticsPayment(shipment, file);
                              }}
                              className="w-full text-xs text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:text-white file:text-xs file:font-semibold"
                            />
                          </label>
                        ) : payment?.status === 'submitted' ? (
                          <p className="text-xs text-emerald-800">
                            Receipt submitted. Awaiting admin confirmation. You cannot confirm
                            payment yourself.
                          </p>
                        ) : null}
                        {uploadingPaymentId === shipment.id ? (
                          <p className="text-xs text-gray-500">Uploading receipt…</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
          </div>
        )}

        <div className="fixed bottom-0 inset-x-0 z-20 border-t border-gray-200 bg-white/95 backdrop-blur-sm">
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
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                Packing Instructions / Remarks
              </span>
              <textarea
                value={packingInstructions}
                onChange={(e) => setPackingInstructions(e.target.value)}
                rows={2}
                disabled={selectedCount === 0}
                placeholder="Optional notes for admin when packing your goods (saved with this shipping request)"
                className="w-full text-xs font-medium px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-800 disabled:bg-gray-100 disabled:text-gray-400 resize-y"
              />
              <span className="text-[10px] text-gray-500">
                Saved on your packing request only — separate from any later admin shipment remarks.
              </span>
            </label>
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
