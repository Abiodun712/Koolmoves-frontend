import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { makeShipmentCode, parseRatePerKgFromFeeText } from '../lib/logisticsCosting';
import { parseNonNegativeFeeInput, storedFeeToInput } from '../lib/logisticsSettings';
import { normalizeWarehouse, type Warehouse } from '../types/warehouse';

type RequestGood = {
  id: string;
  goods_description: string | null;
  quantity: number | null;
  weight_kg: number | null;
  cbm: number | null;
  tracking_number: string | null;
};

type ShippingRequestRow = {
  id: string;
  user_id: string;
  km_id: string;
  freight_type: 'air' | 'sea';
  china_warehouse_id: string | null;
  nigeria_pickup_warehouse_id: string;
  user_packing_instructions: string | null;
  shipment_id: string | null;
  status: string;
  created_at: string;
  user_full_name: string | null;
  user_email: string | null;
  goods: RequestGood[];
  pickup: Warehouse | null;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Admin Shipping Requests queue — pending user packing/shipping requests.
 * Process = assign selected goods to a shipment (existing shipments structure).
 * User packing instructions are shown separately from Admin Shipment Remarks.
 */
export default function AdminShippingRequests() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [requests, setRequests] = useState<ShippingRequestRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [rateHint, setRateHint] = useState<number | null>(null);
  const [seaRateHint, setSeaRateHint] = useState<number | null>(null);
  const [defaultPackingFee, setDefaultPackingFee] = useState<number | null>(null);
  const [defaultClearingFee, setDefaultClearingFee] = useState<number | null>(null);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        { data: warehouseRows },
        { data: requestRows, error: reqErr },
        { data: feeRows },
      ] = await Promise.all([
          supabase.from('warehouses').select('*'),
          supabase
            .from('packing_requests')
            .select(
              'id, user_id, km_id, freight_type, china_warehouse_id, nigeria_pickup_warehouse_id, user_packing_instructions, shipment_id, status, created_at'
            )
            .order('created_at', { ascending: false }),
          supabase
            .from('site_settings')
            .select('key, value')
            .in('key', ['air_freight_fee', 'sea_freight_fee', 'packing_fee', 'clearing_fee']),
        ]);

      if (reqErr) {
        setError(
          reqErr.message ||
            'Could not load shipping requests. Ensure warehouses.sql and shipments.sql are applied.'
        );
        setRequests([]);
        return;
      }

      const settingsMap: Record<string, string> = {};
      (feeRows || []).forEach((row: { key: string; value: string }) => {
        settingsMap[row.key] = row.value ?? '';
      });
      setRateHint(parseRatePerKgFromFeeText(settingsMap.air_freight_fee ?? null));
      const seaRate = parseNonNegativeFeeInput(
        storedFeeToInput(settingsMap.sea_freight_fee) || '0',
        'Sea freight fee'
      );
      setSeaRateHint(seaRate.ok ? seaRate.value : null);
      const packing = parseNonNegativeFeeInput(
        storedFeeToInput(settingsMap.packing_fee) || '0',
        'Packing fee'
      );
      const clearing = parseNonNegativeFeeInput(
        storedFeeToInput(settingsMap.clearing_fee) || '0',
        'Clearing fee'
      );
      setDefaultPackingFee(packing.ok ? packing.value : null);
      setDefaultClearingFee(clearing.ok ? clearing.value : null);

      const whMap = new Map<string, Warehouse>();
      (warehouseRows || []).forEach((row) => {
        const w = normalizeWarehouse(row);
        whMap.set(w.id, w);
      });

      const rows = requestRows || [];
      const userIds = Array.from(new Set(rows.map((r: any) => String(r.user_id))));
      const profileByUser = new Map<
        string,
        { full_name: string | null; email: string | null; km_id: string | null }
      >();

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, full_name, email, km_id')
          .in('user_id', userIds);
        (profiles || []).forEach((p: any) => {
          profileByUser.set(String(p.user_id), {
            full_name: p.full_name ?? null,
            email: p.email ?? null,
            km_id: p.km_id ?? null,
          });
        });
      }

      const requestIds = rows.map((r: any) => String(r.id));
      const goodsByRequest = new Map<string, RequestGood[]>();

      if (requestIds.length > 0) {
        const { data: airItems } = await supabase
          .from('air_packing_request_items')
          .select('request_id, goods_id')
          .in('request_id', requestIds);

        const goodsIds = Array.from(
          new Set((airItems || []).map((i: any) => String(i.goods_id)))
        );
        const goodsById = new Map<string, RequestGood>();

        if (goodsIds.length > 0) {
          const { data: goodsRows } = await supabase
            .from('air_freight_goods')
            .select('id, goods_description, quantity, weight_kg, tracking_number')
            .in('id', goodsIds);
          (goodsRows || []).forEach((g: any) => {
            goodsById.set(String(g.id), {
              id: String(g.id),
              goods_description: g.goods_description ?? null,
              quantity: g.quantity != null ? Number(g.quantity) : null,
              weight_kg: g.weight_kg != null ? Number(g.weight_kg) : null,
              cbm: null,
              tracking_number: g.tracking_number ?? null,
            });
          });
        }

        (airItems || []).forEach((i: any) => {
          const rid = String(i.request_id);
          const good = goodsById.get(String(i.goods_id));
          if (!good) return;
          const list = goodsByRequest.get(rid) || [];
          list.push(good);
          goodsByRequest.set(rid, list);
        });

        const { data: seaItems, error: seaItemsErr } = await supabase
          .from('sea_packing_request_items')
          .select('request_id, goods_id')
          .in('request_id', requestIds);

        if (!seaItemsErr && seaItems && seaItems.length > 0) {
          const seaGoodsIds = Array.from(
            new Set(seaItems.map((i: any) => String(i.goods_id)))
          );
          const seaGoodsById = new Map<string, RequestGood>();

          if (seaGoodsIds.length > 0) {
            const { data: seaGoodsRows } = await supabase
              .from('sea_freight_goods')
              .select('id, goods_description, quantity, cbm, tracking_number')
              .in('id', seaGoodsIds);
            (seaGoodsRows || []).forEach((g: any) => {
              seaGoodsById.set(String(g.id), {
                id: String(g.id),
                goods_description: g.goods_description ?? null,
                quantity: g.quantity != null ? Number(g.quantity) : null,
                weight_kg: null,
                cbm: g.cbm != null ? Number(g.cbm) : null,
                tracking_number: g.tracking_number ?? null,
              });
            });
          }

          seaItems.forEach((i: any) => {
            const rid = String(i.request_id);
            const good = seaGoodsById.get(String(i.goods_id));
            if (!good) return;
            const list = goodsByRequest.get(rid) || [];
            list.push(good);
            goodsByRequest.set(rid, list);
          });
        }
      }

      const normalized: ShippingRequestRow[] = rows.map((r: any) => {
        const profile = profileByUser.get(String(r.user_id));
        const freight: 'air' | 'sea' = r.freight_type === 'sea' ? 'sea' : 'air';
        return {
          id: String(r.id),
          user_id: String(r.user_id),
          km_id: String(r.km_id || profile?.km_id || '—'),
          freight_type: freight,
          china_warehouse_id: r.china_warehouse_id ? String(r.china_warehouse_id) : null,
          nigeria_pickup_warehouse_id: String(r.nigeria_pickup_warehouse_id),
          user_packing_instructions: r.user_packing_instructions ?? null,
          shipment_id: r.shipment_id ? String(r.shipment_id) : null,
          status: String(r.status || 'pending_packing'),
          created_at: String(r.created_at || ''),
          user_full_name: profile?.full_name ?? null,
          user_email: profile?.email ?? null,
          goods: goodsByRequest.get(String(r.id)) || [],
          pickup: whMap.get(String(r.nigeria_pickup_warehouse_id)) || null,
        };
      });

      setRequests(normalized);
      setSelectedId((prev) => (prev && !normalized.some((r) => r.id === prev) ? null : prev));
    } catch (err: any) {
      setError(err?.message || 'Failed to load shipping requests.');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const pendingRequests = useMemo(
    () => requests.filter((r) => !r.shipment_id),
    [requests]
  );

  const visibleRequests = filter === 'pending' ? pendingRequests : requests;

  const selected = useMemo(
    () => requests.find((r) => r.id === selectedId) || null,
    [requests, selectedId]
  );

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const processRequest = async (request: ShippingRequestRow) => {
    setMessage(null);
    setError(null);

    if (request.shipment_id) {
      setError('This request is already assigned to a shipment.');
      return;
    }
    if (request.freight_type !== 'air' && request.freight_type !== 'sea') {
      setError('Unknown freight type. Only Air and Sea packing requests can be processed.');
      return;
    }
    if (request.goods.length === 0) {
      setError(
        request.freight_type === 'sea'
          ? 'This request has no Sea goods items to assign.'
          : 'This request has no Air goods items to assign.'
      );
      return;
    }

    setProcessing(true);
    try {
      if (request.freight_type === 'sea') {
        const shipmentCode = makeShipmentCode('sea');
        const { data: shipmentRow, error: shipErr } = await supabase
          .from('shipments')
          .insert({
            shipment_code: shipmentCode,
            freight_type: 'sea',
            status: 'assigned',
            user_id: request.user_id,
            km_id: request.km_id,
            packing_request_id: request.id,
            china_warehouse_id: request.china_warehouse_id,
            nigeria_pickup_warehouse_id: request.nigeria_pickup_warehouse_id,
            packing_fee: defaultPackingFee ?? 0,
            landing_cost: defaultClearingFee ?? 0,
            rate_per_cbm: seaRateHint,
            created_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
          })
          .select('id, shipment_code')
          .single();

        if (shipErr || !shipmentRow) {
          setError(
            shipErr?.message ||
              'Could not create Sea shipment. Apply supabase/sea_shipments.sql in Supabase.'
          );
          return;
        }

        const { error: itemsErr } = await supabase.from('sea_shipment_items').insert(
          request.goods.map((g) => ({
            shipment_id: shipmentRow.id,
            goods_id: g.id,
            packing_request_id: request.id,
          }))
        );
        if (itemsErr) {
          setError(itemsErr.message || 'Shipment created but Sea goods assignment failed.');
          return;
        }

        const { error: linkErr } = await supabase
          .from('packing_requests')
          .update({
            shipment_id: shipmentRow.id,
            status: 'assigned_to_shipment',
          })
          .eq('id', request.id);

        if (linkErr) {
          setError(linkErr.message || 'Shipment created but request link failed.');
          return;
        }

        setMessage(
          `Request processed → shipment ${shipmentRow.shipment_code} created. Continue packing/costing on Admin Sea Freight.`
        );
        await loadRequests();
        return;
      }

      const shipmentCode = makeShipmentCode('air');
      const { data: shipmentRow, error: shipErr } = await supabase
        .from('shipments')
        .insert({
          shipment_code: shipmentCode,
          freight_type: 'air',
          status: 'assigned',
          user_id: request.user_id,
          km_id: request.km_id,
          packing_request_id: request.id,
          china_warehouse_id: request.china_warehouse_id,
          nigeria_pickup_warehouse_id: request.nigeria_pickup_warehouse_id,
          packing_fee: defaultPackingFee ?? 0,
          landing_cost: defaultClearingFee ?? 0,
          rate_per_kg: rateHint,
          created_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .select('id, shipment_code')
        .single();

      if (shipErr || !shipmentRow) {
        setError(
          shipErr?.message ||
            'Could not create shipment. Apply supabase/shipments.sql in Supabase.'
        );
        return;
      }

      const { error: itemsErr } = await supabase.from('air_shipment_items').insert(
        request.goods.map((g) => ({
          shipment_id: shipmentRow.id,
          goods_id: g.id,
          packing_request_id: request.id,
        }))
      );
      if (itemsErr) {
        setError(itemsErr.message || 'Shipment created but goods assignment failed.');
        return;
      }

      const { error: linkErr } = await supabase
        .from('packing_requests')
        .update({
          shipment_id: shipmentRow.id,
          status: 'assigned_to_shipment',
        })
        .eq('id', request.id);

      if (linkErr) {
        setError(linkErr.message || 'Shipment created but request link failed.');
        return;
      }

      setMessage(
        `Request processed → shipment ${shipmentRow.shipment_code} created. Continue packing/costing on Admin Air Freight.`
      );
      await loadRequests();
    } catch (err: any) {
      setError(err?.message || 'Failed to process shipping request.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-8 bg-gradient-to-br from-indigo-950 via-purple-950 to-slate-900 min-h-screen text-white rounded-3xl shadow-2xl border border-purple-500/30 my-8 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center pb-6 border-b border-purple-800/60 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold bg-gradient-to-r from-pink-400 via-purple-300 to-cyan-400 bg-clip-text text-transparent">
            Admin Shipping Requests
          </h1>
          <p className="text-xs md:text-sm text-purple-200 mt-1">
            Queue of user packing/shipping requests. Open a request to review packing instructions
            and process it into a shipment.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to="/admin/air-freight"
            className="bg-cyan-800/65 hover:bg-cyan-700 text-cyan-100 px-4 py-2 rounded-xl text-xs font-semibold border border-cyan-500/30"
          >
            Air Freight / Shipments
          </Link>
          <Link
            to="/admin/sea-freight"
            className="bg-sky-800/65 hover:bg-sky-700 text-sky-100 px-4 py-2 rounded-xl text-xs font-semibold border border-sky-500/30"
          >
            Sea Freight
          </Link>
          <Link
            to="/admin"
            className="bg-purple-800/65 hover:bg-purple-700 text-cyan-200 px-4 py-2 rounded-xl text-xs font-semibold border border-purple-500/30"
          >
            ← Exchange Admin
          </Link>
          <button
            type="button"
            onClick={() => loadRequests()}
            className="bg-purple-800/65 hover:bg-purple-700 text-cyan-200 px-4 py-2 rounded-xl text-xs font-semibold border border-purple-500/30"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="bg-rose-700/80 hover:bg-rose-600 text-white px-4 py-2 rounded-xl text-xs font-semibold border border-rose-500/30"
          >
            Log Out
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter('pending')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold border ${
            filter === 'pending'
              ? 'bg-amber-600 border-amber-400 text-white'
              : 'bg-slate-900/80 border-purple-500/40 text-purple-200'
          }`}
        >
          Pending ({pendingRequests.length})
        </button>
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold border ${
            filter === 'all'
              ? 'bg-cyan-600 border-cyan-400 text-white'
              : 'bg-slate-900/80 border-purple-500/40 text-purple-200'
          }`}
        >
          All ({requests.length})
        </button>
      </div>

      {error && (
        <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
          {error}
        </p>
      )}
      {message && (
        <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2">
          {message}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* QUEUE */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-cyan-200 uppercase tracking-wider">
            Shipping request queue
          </h2>
          {loading ? (
            <p className="text-xs text-purple-200">Loading requests…</p>
          ) : visibleRequests.length === 0 ? (
            <p className="text-xs text-purple-300/80 p-4 rounded-xl border border-purple-500/30 bg-slate-900/80">
              {filter === 'pending'
                ? 'No pending shipping requests.'
                : 'No shipping requests found.'}
            </p>
          ) : (
            visibleRequests.map((req) => (
              <button
                key={req.id}
                type="button"
                onClick={() => {
                  setSelectedId(req.id);
                  setMessage(null);
                  setError(null);
                }}
                className={`w-full text-left p-4 rounded-2xl border transition-all space-y-2 ${
                  selectedId === req.id
                    ? 'border-amber-400 bg-amber-500/10'
                    : 'border-purple-500/30 bg-slate-900/80 hover:border-purple-400/50'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-white">
                      {req.user_full_name || 'User'} · {req.km_id}
                    </p>
                    <p className="text-[11px] text-purple-300">{req.user_email || '—'}</p>
                  </div>
                  <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-lg bg-slate-800 border border-purple-500/40 text-cyan-100">
                    {req.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                  <span className="px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 uppercase">
                    {req.freight_type}
                  </span>
                  <span className="px-2 py-1 rounded-lg bg-white/5 border border-purple-500/30 text-purple-100">
                    {req.goods.length} goods
                  </span>
                  <span className="px-2 py-1 rounded-lg bg-white/5 border border-purple-500/30 text-purple-100">
                    {formatDateTime(req.created_at)}
                  </span>
                </div>
                {req.user_packing_instructions?.trim() ? (
                  <p className="text-[11px] text-amber-100/90 line-clamp-2">
                    Instructions: {req.user_packing_instructions.trim()}
                  </p>
                ) : (
                  <p className="text-[11px] text-purple-400">No packing instructions</p>
                )}
              </button>
            ))
          )}
        </div>

        {/* DETAIL / PROCESS */}
        <div className="p-5 rounded-2xl border border-amber-500/40 bg-slate-900/90 space-y-4 min-h-[320px]">
          <h2 className="text-sm font-bold text-amber-200 uppercase tracking-wider">
            Request details
          </h2>
          {!selected ? (
            <p className="text-xs text-purple-300">Select a shipping request from the queue.</p>
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase text-purple-300">User</p>
                <p className="text-sm font-bold text-white">
                  {selected.user_full_name || '—'} ({selected.km_id})
                </p>
                <p className="text-xs text-purple-200">{selected.user_email || '—'}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-[10px] font-bold uppercase text-purple-300">Freight type</p>
                  <p className="font-bold text-white uppercase mt-0.5">{selected.freight_type}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-purple-300">Status</p>
                  <p className="font-bold text-white mt-0.5">{selected.status}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] font-bold uppercase text-purple-300">Request date</p>
                  <p className="font-semibold text-white mt-0.5">
                    {formatDateTime(selected.created_at)}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] font-bold uppercase text-purple-300">
                    Nigeria pickup
                  </p>
                  <p className="font-semibold text-white mt-0.5">
                    {selected.pickup?.name || '—'}
                  </p>
                  {selected.pickup?.address && (
                    <p className="text-[11px] text-purple-200 whitespace-pre-line mt-1">
                      {selected.pickup.address}
                    </p>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-xl border border-amber-400/50 bg-amber-500/10 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-200">
                  User Packing Instructions / Remarks
                </p>
                <p className="text-sm text-amber-50 whitespace-pre-line leading-relaxed">
                  {selected.user_packing_instructions?.trim() || '— (none provided)'}
                </p>
                <p className="text-[10px] text-amber-200/70 pt-1">
                  Separate from Admin Shipment Remarks (entered later on the shipment).
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase text-purple-300">Selected goods</p>
                {selected.goods.length === 0 ? (
                  <p className="text-xs text-purple-300">No goods linked to this request.</p>
                ) : (
                  <ul className="space-y-2">
                    {selected.goods.map((g) => (
                      <li
                        key={g.id}
                        className="p-3 rounded-xl bg-slate-950/70 border border-purple-500/30 text-xs"
                      >
                        <p className="font-bold text-white">
                          {g.goods_description || 'Untitled goods'}
                        </p>
                        <p className="text-purple-200 mt-0.5">
                          Qty {g.quantity ?? '—'} ·{' '}
                          {selected.freight_type === 'sea'
                            ? `recorded CBM ${g.cbm != null ? `${g.cbm} CBM` : '—'}`
                            : `recorded weight ${g.weight_kg != null ? `${g.weight_kg} kg` : '—'}`}
                          {g.tracking_number ? ` · ${g.tracking_number}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {selected.shipment_id ? (
                <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2">
                  Already processed. Shipment linked. Continue on{' '}
                  {selected.freight_type === 'sea' ? (
                    <Link to="/admin/sea-freight" className="underline font-bold">
                      Admin Sea Freight
                    </Link>
                  ) : (
                    <Link to="/admin/air-freight" className="underline font-bold">
                      Admin Air Freight
                    </Link>
                  )}{' '}
                  for pack / cost / finalize.
                </p>
              ) : (
                <button
                  type="button"
                  disabled={processing}
                  onClick={() => processRequest(selected)}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-3 rounded-xl text-xs font-bold"
                >
                  {processing
                    ? 'Processing…'
                    : selected.freight_type === 'sea'
                      ? 'Process request → create Sea shipment'
                      : 'Process request → create shipment'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
