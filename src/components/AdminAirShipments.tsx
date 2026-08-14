import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  computeShipmentTotalDue,
  makeShipmentCode,
  parseRatePerKgFromFeeText,
} from '../lib/logisticsCosting';
import {
  normalizeLogisticsShipment,
  type LogisticsShipment,
} from '../types/shipment';
import { normalizeWarehouse, type Warehouse } from '../types/warehouse';
import { useAuth } from '../contexts/AuthContext';

type PackingRequestRow = {
  id: string;
  user_id: string;
  km_id: string;
  freight_type: string;
  china_warehouse_id: string | null;
  nigeria_pickup_warehouse_id: string;
  user_packing_instructions: string | null;
  shipment_id: string | null;
  status: string;
  created_at: string;
  goods: Array<{
    id: string;
    goods_description: string | null;
    quantity: number | null;
    weight_kg: number | null;
  }>;
  pickup?: Warehouse | null;
};

type CostForm = {
  departure_date: string;
  estimated_arrival: string;
  final_packed_weight_kg: string;
  packing_fee: string;
  landing_cost: string;
  rate_per_kg: string;
  admin_shipment_remarks: string;
};

const emptyCostForm = (rateHint: number | null): CostForm => ({
  departure_date: '',
  estimated_arrival: '',
  final_packed_weight_kg: '',
  packing_fee: '0',
  landing_cost: '0',
  rate_per_kg: rateHint != null ? String(rateHint) : '',
  admin_shipment_remarks: '',
});

function formatMoney(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—';
  return `₦${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Admin Air packing-request review → assign to shipment → pack/cost/finalize.
 * Embedded on Admin Air Freight (does not touch Exchange).
 */
export default function AdminAirShipments({ publishedFeeText }: { publishedFeeText: string }) {
  const { user } = useAuth();
  const rateHint = useMemo(
    () => parseRatePerKgFromFeeText(publishedFeeText),
    [publishedFeeText]
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [requests, setRequests] = useState<PackingRequestRow[]>([]);
  const [shipments, setShipments] = useState<LogisticsShipment[]>([]);
  const [warehouseById, setWarehouseById] = useState<Map<string, Warehouse>>(new Map());
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [costForm, setCostForm] = useState<CostForm>(() => emptyCostForm(null));
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: warehouseRows }, { data: requestRows, error: reqErr }, { data: shipmentRows }] =
        await Promise.all([
          supabase.from('warehouses').select('*'),
          supabase
            .from('packing_requests')
            .select('*')
            .eq('freight_type', 'air')
            .order('created_at', { ascending: false }),
          supabase
            .from('shipments')
            .select('*')
            .eq('freight_type', 'air')
            .order('created_at', { ascending: false }),
        ]);

      if (reqErr) {
        setError(
          reqErr.message ||
            'Could not load packing requests. Ensure warehouses.sql / shipments.sql are applied.'
        );
        setRequests([]);
        setShipments([]);
        return;
      }

      const whMap = new Map<string, Warehouse>();
      (warehouseRows || []).forEach((row) => {
        const w = normalizeWarehouse(row);
        whMap.set(w.id, w);
      });
      setWarehouseById(whMap);

      const requestIds = (requestRows || []).map((r: any) => r.id);
      let itemsByRequest = new Map<string, PackingRequestRow['goods']>();

      if (requestIds.length > 0) {
        const { data: itemRows } = await supabase
          .from('air_packing_request_items')
          .select('request_id, goods_id')
          .in('request_id', requestIds);

        const goodsIds = Array.from(
          new Set((itemRows || []).map((i: any) => String(i.goods_id)))
        );
        let goodsById = new Map<string, PackingRequestRow['goods'][number]>();
        if (goodsIds.length > 0) {
          const { data: goodsRows } = await supabase
            .from('air_freight_goods')
            .select('id, goods_description, quantity, weight_kg')
            .in('id', goodsIds);
          (goodsRows || []).forEach((g: any) => {
            goodsById.set(String(g.id), {
              id: String(g.id),
              goods_description: g.goods_description ?? null,
              quantity: g.quantity != null ? Number(g.quantity) : null,
              weight_kg: g.weight_kg != null ? Number(g.weight_kg) : null,
            });
          });
        }

        itemsByRequest = new Map();
        (itemRows || []).forEach((i: any) => {
          const rid = String(i.request_id);
          const good = goodsById.get(String(i.goods_id));
          if (!good) return;
          const list = itemsByRequest.get(rid) || [];
          list.push(good);
          itemsByRequest.set(rid, list);
        });
      }

      setRequests(
        (requestRows || []).map((r: any) => ({
          id: String(r.id),
          user_id: String(r.user_id),
          km_id: String(r.km_id),
          freight_type: String(r.freight_type),
          china_warehouse_id: r.china_warehouse_id ? String(r.china_warehouse_id) : null,
          nigeria_pickup_warehouse_id: String(r.nigeria_pickup_warehouse_id),
          user_packing_instructions: r.user_packing_instructions ?? null,
          shipment_id: r.shipment_id ? String(r.shipment_id) : null,
          status: String(r.status),
          created_at: String(r.created_at),
          goods: itemsByRequest.get(String(r.id)) || [],
          pickup: whMap.get(String(r.nigeria_pickup_warehouse_id)) || null,
        }))
      );

      setShipments((shipmentRows || []).map((row) => normalizeLogisticsShipment(row)));
    } catch (err: any) {
      setError(err?.message || 'Failed to load shipment foundation data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    setCostForm((prev) => ({
      ...prev,
      rate_per_kg:
        prev.rate_per_kg || (rateHint != null ? String(rateHint) : prev.rate_per_kg),
    }));
  }, [rateHint]);

  const selectedShipment = useMemo(
    () => shipments.find((s) => s.id === selectedShipmentId) || null,
    [shipments, selectedShipmentId]
  );

  const previewDue = useMemo(() => {
    const weight = Number(costForm.final_packed_weight_kg);
    const rate = Number(costForm.rate_per_kg);
    const packingFee = Number(costForm.packing_fee);
    const landingCost = Number(costForm.landing_cost);
    if (![weight, rate, packingFee, landingCost].every((n) => Number.isFinite(n))) {
      return null;
    }
    return computeShipmentTotalDue({
      finalPackedWeightKg: weight,
      ratePerKg: rate,
      packingFee,
      landingCost,
    });
  }, [costForm]);

  const assignRequestToShipment = async (request: PackingRequestRow) => {
    setMessage(null);
    setError(null);
    if (request.shipment_id) {
      setError('This packing request is already assigned to a shipment.');
      return;
    }
    if (request.goods.length === 0) {
      setError('Packing request has no Air goods items.');
      return;
    }

    setSaving(true);
    try {
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
          packing_fee: 0,
          landing_cost: 0,
          rate_per_kg: rateHint,
          created_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .select('*')
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
        setError(linkErr.message || 'Shipment created but packing request link failed.');
        return;
      }

      setMessage(`Shipment ${shipmentCode} created and goods assigned.`);
      setSelectedShipmentId(String(shipmentRow.id));
      setCostForm({
        ...emptyCostForm(rateHint),
        rate_per_kg:
          shipmentRow.rate_per_kg != null
            ? String(shipmentRow.rate_per_kg)
            : rateHint != null
              ? String(rateHint)
              : '',
        admin_shipment_remarks: shipmentRow.admin_shipment_remarks || '',
      });
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to assign packing request.');
    } finally {
      setSaving(false);
    }
  };

  const openShipmentEditor = (shipment: LogisticsShipment) => {
    setSelectedShipmentId(shipment.id);
    setMessage(null);
    setError(null);
    setCostForm({
      departure_date: shipment.departure_date || '',
      estimated_arrival: shipment.estimated_arrival || '',
      final_packed_weight_kg:
        shipment.final_packed_weight_kg != null ? String(shipment.final_packed_weight_kg) : '',
      packing_fee: String(shipment.packing_fee ?? 0),
      landing_cost: String(shipment.landing_cost ?? 0),
      rate_per_kg:
        shipment.rate_per_kg != null
          ? String(shipment.rate_per_kg)
          : rateHint != null
            ? String(rateHint)
            : '',
      admin_shipment_remarks: shipment.admin_shipment_remarks || '',
    });
  };

  const saveShipmentCosting = async (finalize: boolean) => {
    setMessage(null);
    setError(null);
    if (!selectedShipment) {
      setError('Select a shipment first.');
      return;
    }

    const weight = Number(costForm.final_packed_weight_kg);
    const rate = Number(costForm.rate_per_kg);
    const packingFee = Number(costForm.packing_fee);
    const landingCost = Number(costForm.landing_cost);

    if (!Number.isFinite(weight) || weight <= 0) {
      setError('Enter the final packed / re-weighed shipment weight (kg). Do not auto-sum items.');
      return;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      setError('Enter rate per kg (from published Air fee or override).');
      return;
    }
    if (!Number.isFinite(packingFee) || packingFee < 0) {
      setError('Enter a valid packing fee (shipment-level).');
      return;
    }
    if (!Number.isFinite(landingCost) || landingCost < 0) {
      setError('Enter a valid landing cost (shipment-level).');
      return;
    }

    const { freightCharge, totalAmountDue } = computeShipmentTotalDue({
      finalPackedWeightKg: weight,
      ratePerKg: rate,
      packingFee,
      landingCost,
    });

    setSaving(true);
    try {
      const payload: Record<string, any> = {
        departure_date: costForm.departure_date || null,
        estimated_arrival: costForm.estimated_arrival || null,
        final_packed_weight_kg: weight,
        packing_fee: packingFee,
        landing_cost: landingCost,
        rate_per_kg: rate,
        freight_charge: freightCharge,
        total_amount_due: totalAmountDue,
        admin_shipment_remarks: costForm.admin_shipment_remarks.trim() || null,
        status: finalize ? 'finalized' : 'packed',
        updated_at: new Date().toISOString(),
      };
      if (finalize) {
        payload.finalized_at = new Date().toISOString();
      }

      const { error: updErr } = await supabase
        .from('shipments')
        .update(payload)
        .eq('id', selectedShipment.id);

      if (updErr) {
        setError(updErr.message || 'Failed to save shipment costing.');
        return;
      }

      if (finalize && selectedShipment.packing_request_id) {
        await supabase
          .from('packing_requests')
          .update({ status: 'shipment_finalized' })
          .eq('id', selectedShipment.packing_request_id);
      }

      setMessage(
        finalize
          ? `Shipment ${selectedShipment.shipment_code} finalized. User can see full Nigeria pickup address.`
          : `Shipment ${selectedShipment.shipment_code} costing saved (packed).`
      );
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to save shipment.');
    } finally {
      setSaving(false);
    }
  };

  const pendingRequests = requests.filter((r) => !r.shipment_id);

  return (
    <div className="p-5 bg-slate-900/90 rounded-2xl border border-emerald-500/40 shadow-xl space-y-5">
      <div>
        <h2 className="text-sm font-bold text-emerald-200 uppercase tracking-wider">
          Packing requests & shipments
        </h2>
        <p className="text-xs text-purple-300/80 mt-1">
          Review user packing instructions → assign goods to a shipment → enter final packed weight
          (manual) → packing fee &amp; landing cost once → finalize. Item weights stay on each good.
        </p>
      </div>

      {loading && <p className="text-xs text-purple-200">Loading…</p>}
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

      <div className="space-y-3">
        <h3 className="text-xs font-bold text-cyan-200 uppercase tracking-wider">
          Pending packing requests
        </h3>
        {pendingRequests.length === 0 && !loading ? (
          <p className="text-xs text-purple-300/70">No unassigned Air packing requests.</p>
        ) : (
          pendingRequests.map((req) => (
            <div
              key={req.id}
              className="p-4 rounded-xl border border-purple-500/30 bg-slate-950/60 space-y-2"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-white">KM-ID {req.km_id}</p>
                  <p className="text-[11px] text-purple-300">
                    {req.goods.length} item{req.goods.length === 1 ? '' : 's'} · {req.status}
                  </p>
                  <p className="text-[11px] text-cyan-100/90 mt-1">
                    Pickup: {req.pickup?.name || '—'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => assignRequestToShipment(req)}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-2 rounded-xl text-[11px] font-bold"
                >
                  Assign to shipment
                </button>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-amber-200/90">
                  User packing instructions
                </p>
                <p className="text-xs text-purple-100 whitespace-pre-line mt-0.5">
                  {req.user_packing_instructions?.trim() || '—'}
                </p>
              </div>
              <ul className="text-[11px] text-purple-200/90 space-y-0.5">
                {req.goods.map((g) => (
                  <li key={g.id}>
                    {g.goods_description || 'Untitled'} · qty {g.quantity ?? '—'} · recorded{' '}
                    {g.weight_kg != null ? `${g.weight_kg} kg` : '—'}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-bold text-cyan-200 uppercase tracking-wider">Air shipments</h3>
        {shipments.length === 0 && !loading ? (
          <p className="text-xs text-purple-300/70">No shipments yet.</p>
        ) : (
          <div className="space-y-2">
            {shipments.map((s) => {
              const pickup = warehouseById.get(s.nigeria_pickup_warehouse_id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openShipmentEditor(s)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    selectedShipmentId === s.id
                      ? 'border-emerald-400 bg-emerald-500/10'
                      : 'border-purple-500/30 bg-slate-950/50 hover:border-purple-400/50'
                  }`}
                >
                  <p className="text-sm font-bold text-white">{s.shipment_code}</p>
                  <p className="text-[11px] text-purple-200">
                    {s.km_id} · {s.status} · due {formatMoney(s.total_amount_due)}
                  </p>
                  <p className="text-[11px] text-cyan-100/80 mt-0.5">
                    Pickup warehouse: {pickup?.name || '—'}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedShipment && (
        <div className="p-4 rounded-xl border border-amber-500/40 bg-slate-950/70 space-y-3">
          <div>
            <h3 className="text-sm font-bold text-amber-200">
              Cost &amp; finalize — {selectedShipment.shipment_code}
            </h3>
            <p className="text-[11px] text-purple-300 mt-0.5">
              Status: {selectedShipment.status}. Final packed weight is manual (not sum of item
              weights). Packing fee &amp; landing cost are shipment-level once.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-amber-100/80">
                Departure date
              </span>
              <input
                type="date"
                value={costForm.departure_date}
                onChange={(e) => setCostForm((f) => ({ ...f, departure_date: e.target.value }))}
                className="w-full p-2 rounded-xl bg-slate-800 text-white border border-amber-500/30 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-amber-100/80">
                Estimated arrival
              </span>
              <input
                type="date"
                value={costForm.estimated_arrival}
                onChange={(e) => setCostForm((f) => ({ ...f, estimated_arrival: e.target.value }))}
                className="w-full p-2 rounded-xl bg-slate-800 text-white border border-amber-500/30 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-amber-100/80">
                Final packed weight (kg)
              </span>
              <input
                type="number"
                min="0"
                step="0.001"
                value={costForm.final_packed_weight_kg}
                onChange={(e) =>
                  setCostForm((f) => ({ ...f, final_packed_weight_kg: e.target.value }))
                }
                placeholder="Admin re-weigh"
                className="w-full p-2 rounded-xl bg-slate-800 text-white border border-amber-500/30 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-amber-100/80">
                Rate per kg (₦)
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={costForm.rate_per_kg}
                onChange={(e) => setCostForm((f) => ({ ...f, rate_per_kg: e.target.value }))}
                className="w-full p-2 rounded-xl bg-slate-800 text-white border border-amber-500/30 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-amber-100/80">
                Packing fee (₦)
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={costForm.packing_fee}
                onChange={(e) => setCostForm((f) => ({ ...f, packing_fee: e.target.value }))}
                className="w-full p-2 rounded-xl bg-slate-800 text-white border border-amber-500/30 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-amber-100/80">
                Landing cost (₦)
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={costForm.landing_cost}
                onChange={(e) => setCostForm((f) => ({ ...f, landing_cost: e.target.value }))}
                className="w-full p-2 rounded-xl bg-slate-800 text-white border border-amber-500/30 text-sm"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase text-amber-100/80">
              Admin shipment remarks
            </span>
            <textarea
              rows={2}
              value={costForm.admin_shipment_remarks}
              onChange={(e) =>
                setCostForm((f) => ({ ...f, admin_shipment_remarks: e.target.value }))
              }
              placeholder="Separate from user packing instructions"
              className="w-full p-2 rounded-xl bg-slate-800 text-white border border-amber-500/30 text-sm resize-y"
            />
          </label>

          {previewDue && (
            <div className="text-xs text-emerald-100 space-y-0.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
              <p>
                Freight charge:{' '}
                <span className="font-bold">{formatMoney(previewDue.freightCharge)}</span>
              </p>
              <p>
                Total amount due:{' '}
                <span className="font-extrabold text-base">
                  {formatMoney(previewDue.totalAmountDue)}
                </span>
              </p>
              <p className="text-[10px] text-emerald-200/80">
                = (final packed kg × rate) + packing fee + landing cost
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving || selectedShipment.status === 'finalized'}
              onClick={() => saveShipmentCosting(false)}
              className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold"
            >
              Save packed / costing
            </button>
            <button
              type="button"
              disabled={saving || selectedShipment.status === 'finalized'}
              onClick={() => saveShipmentCosting(true)}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold"
            >
              Finalize shipment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
