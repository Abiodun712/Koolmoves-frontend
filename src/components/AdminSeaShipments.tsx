import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { computeSeaShipmentTotalDue, makeShipmentCode } from '../lib/logisticsCosting';
import { parseNonNegativeFeeInput, storedFeeToInput } from '../lib/logisticsSettings';
import {
  nextShipmentProgressionStatus,
  normalizeLogisticsShipment,
  shipmentAllowsCosting,
  shipmentProgressionActionLabel,
  shipmentProgressionAllowed,
  type LogisticsShipment,
} from '../types/shipment';
import {
  LOGISTICS_RECEIPT_BUCKET,
  airAdminPickupPaymentLabel,
  seaShipmentMayBeCompleted,
  logisticsPaymentStatusLabel,
  normalizeLogisticsPayment,
  type LogisticsPayment,
} from '../types/logisticsPayment';
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
    cbm: number | null;
  }>;
  pickup?: Warehouse | null;
};

type CostForm = {
  departure_date: string;
  estimated_arrival: string;
  final_packed_cbm: string;
  packing_fee: string;
  clearing_fee: string;
  rate_per_cbm: string;
  admin_shipment_remarks: string;
};

const emptyCostForm = (
  rateHint: number | null,
  packingFee: number | null,
  clearingFee: number | null
): CostForm => ({
  departure_date: '',
  estimated_arrival: '',
  final_packed_cbm: '',
  packing_fee: packingFee != null ? String(packingFee) : '0',
  clearing_fee: clearingFee != null ? String(clearingFee) : '0',
  rate_per_cbm: rateHint != null ? String(rateHint) : '',
  admin_shipment_remarks: '',
});

function formatMoney(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—';
  return `₦${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCbm(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value} CBM`;
}

/**
 * Admin Sea packing-request review → assign → pack/cost/finalize → Sea progression.
 * Does not change Air costing, payment UI, or storage.
 */
export default function AdminSeaShipments() {
  const { user } = useAuth();
  const [rateHint, setRateHint] = useState<number | null>(null);
  const [defaultPackingFee, setDefaultPackingFee] = useState<number | null>(null);
  const [defaultClearingFee, setDefaultClearingFee] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [requests, setRequests] = useState<PackingRequestRow[]>([]);
  const [shipments, setShipments] = useState<LogisticsShipment[]>([]);
  const [paymentByShipmentId, setPaymentByShipmentId] = useState<Record<string, LogisticsPayment>>(
    {}
  );
  const [receiptUrlByShipmentId, setReceiptUrlByShipmentId] = useState<Record<string, string>>({});
  const [rejectionNote, setRejectionNote] = useState('');
  const [warehouseById, setWarehouseById] = useState<Map<string, Warehouse>>(new Map());
  const [goodsCbmByShipmentId, setGoodsCbmByShipmentId] = useState<Record<string, number>>({});
  const [shipmentGoodsById, setShipmentGoodsById] = useState<
    Record<string, PackingRequestRow['goods']>
  >({});
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [costForm, setCostForm] = useState<CostForm>(() => emptyCostForm(null, null, null));
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        { data: warehouseRows },
        { data: requestRows, error: reqErr },
        { data: shipmentRows },
        { data: feeRows },
      ] = await Promise.all([
        supabase.from('warehouses').select('*'),
        supabase
          .from('packing_requests')
          .select('*')
          .eq('freight_type', 'sea')
          .order('created_at', { ascending: false }),
        supabase
          .from('shipments')
          .select('*')
          .eq('freight_type', 'sea')
          .order('created_at', { ascending: false }),
        supabase
          .from('site_settings')
          .select('key, value')
          .in('key', ['sea_freight_fee', 'packing_fee', 'clearing_fee']),
      ]);

      const settingsMap: Record<string, string> = {};
      (feeRows || []).forEach((row: { key: string; value: string }) => {
        settingsMap[row.key] = row.value ?? '';
      });
      const seaRate = parseNonNegativeFeeInput(
        storedFeeToInput(settingsMap.sea_freight_fee) || '0',
        'Sea freight fee'
      );
      const packing = parseNonNegativeFeeInput(
        storedFeeToInput(settingsMap.packing_fee) || '0',
        'Packing fee'
      );
      const clearing = parseNonNegativeFeeInput(
        storedFeeToInput(settingsMap.clearing_fee) || '0',
        'Clearing fee'
      );
      setRateHint(seaRate.ok ? seaRate.value : null);
      setDefaultPackingFee(packing.ok ? packing.value : null);
      setDefaultClearingFee(clearing.ok ? clearing.value : null);

      if (reqErr) {
        setError(
          reqErr.message ||
            'Could not load Sea packing requests. Apply supabase/sea_freight_goods.sql.'
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
      const itemsByRequest = new Map<string, PackingRequestRow['goods']>();

      if (requestIds.length > 0) {
        const { data: itemRows } = await supabase
          .from('sea_packing_request_items')
          .select('request_id, goods_id')
          .in('request_id', requestIds);

        const goodsIds = Array.from(
          new Set((itemRows || []).map((i: any) => String(i.goods_id)))
        );
        const goodsById = new Map<string, PackingRequestRow['goods'][number]>();
        if (goodsIds.length > 0) {
          const { data: goodsRows } = await supabase
            .from('sea_freight_goods')
            .select('id, goods_description, quantity, cbm')
            .in('id', goodsIds);
          (goodsRows || []).forEach((g: any) => {
            goodsById.set(String(g.id), {
              id: String(g.id),
              goods_description: g.goods_description ?? null,
              quantity: g.quantity != null ? Number(g.quantity) : null,
              cbm: g.cbm != null ? Number(g.cbm) : null,
            });
          });
        }
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
          km_id: String(r.km_id ?? ''),
          freight_type: 'sea',
          china_warehouse_id: r.china_warehouse_id ? String(r.china_warehouse_id) : null,
          nigeria_pickup_warehouse_id: String(r.nigeria_pickup_warehouse_id),
          user_packing_instructions: r.user_packing_instructions ?? null,
          shipment_id: r.shipment_id ? String(r.shipment_id) : null,
          status: String(r.status || 'pending_packing'),
          created_at: String(r.created_at || ''),
          goods: itemsByRequest.get(String(r.id)) || [],
          pickup: whMap.get(String(r.nigeria_pickup_warehouse_id)) || null,
        }))
      );

      const normalizedShipments = (shipmentRows || []).map((row) =>
        normalizeLogisticsShipment(row)
      );
      setShipments(normalizedShipments);

      const shipmentIds = normalizedShipments.map((s) => s.id);
      const nextGoods: Record<string, PackingRequestRow['goods']> = {};
      const nextCbm: Record<string, number> = {};
      shipmentIds.forEach((id) => {
        nextGoods[id] = [];
        nextCbm[id] = 0;
      });

      if (shipmentIds.length > 0) {
        const { data: sItems } = await supabase
          .from('sea_shipment_items')
          .select('shipment_id, goods_id')
          .in('shipment_id', shipmentIds);
        const gids = Array.from(new Set((sItems || []).map((i: any) => String(i.goods_id))));
        const gMap = new Map<string, PackingRequestRow['goods'][number]>();
        if (gids.length > 0) {
          const { data: gRows } = await supabase
            .from('sea_freight_goods')
            .select('id, goods_description, quantity, cbm')
            .in('id', gids);
          (gRows || []).forEach((g: any) => {
            gMap.set(String(g.id), {
              id: String(g.id),
              goods_description: g.goods_description ?? null,
              quantity: g.quantity != null ? Number(g.quantity) : null,
              cbm: g.cbm != null ? Number(g.cbm) : null,
            });
          });
        }
        (sItems || []).forEach((i: any) => {
          const sid = String(i.shipment_id);
          const good = gMap.get(String(i.goods_id));
          if (!good) return;
          nextGoods[sid] = [...(nextGoods[sid] || []), good];
          nextCbm[sid] = (nextCbm[sid] || 0) + (good.cbm || 0);
        });
      }
      setShipmentGoodsById(nextGoods);
      setGoodsCbmByShipmentId(nextCbm);

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
      setPaymentByShipmentId(nextPayments);
      setReceiptUrlByShipmentId(nextReceiptUrls);
    } catch (err: any) {
      setError(err?.message || 'Failed to load Sea shipment data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const selectedShipment = useMemo(
    () => shipments.find((s) => s.id === selectedShipmentId) || null,
    [shipments, selectedShipmentId]
  );

  const linkedRequestInstructions = useMemo(() => {
    if (!selectedShipment?.packing_request_id) return null;
    const req = requests.find((r) => r.id === selectedShipment.packing_request_id);
    return req?.user_packing_instructions?.trim() || null;
  }, [selectedShipment, requests]);

  const previewDue = useMemo(() => {
    const cbm = Number(costForm.final_packed_cbm);
    const rate = Number(costForm.rate_per_cbm);
    const packingFee = Number(costForm.packing_fee);
    const clearingFee = Number(costForm.clearing_fee);
    if (![cbm, rate, packingFee, clearingFee].every((n) => Number.isFinite(n))) {
      return null;
    }
    return computeSeaShipmentTotalDue({
      finalPackedCbm: cbm,
      ratePerCbm: rate,
      packingFee,
      clearingFee,
    });
  }, [costForm]);

  const nextProgress = useMemo(() => {
    if (!selectedShipment) return null;
    const next = nextShipmentProgressionStatus('sea', selectedShipment.status);
    if (!next || next === 'completed') return null;
    if (!shipmentProgressionAllowed('sea', selectedShipment.status, next)) return null;
    return next;
  }, [selectedShipment]);

  const assignRequestToShipment = async (request: PackingRequestRow) => {
    setMessage(null);
    setError(null);
    if (request.shipment_id) {
      setError('This packing request is already assigned to a shipment.');
      return;
    }
    if (request.goods.length === 0) {
      setError('Packing request has no Sea goods items.');
      return;
    }

    setSaving(true);
    try {
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
          rate_per_cbm: rateHint,
          created_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .select('*')
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
        setError(linkErr.message || 'Shipment created but packing request link failed.');
        return;
      }

      setMessage(`Shipment ${shipmentCode} created and Sea goods assigned.`);
      setSelectedShipmentId(String(shipmentRow.id));
      setCostForm({
        ...emptyCostForm(rateHint, defaultPackingFee, defaultClearingFee),
        rate_per_cbm:
          shipmentRow.rate_per_cbm != null ? String(shipmentRow.rate_per_cbm) : String(rateHint ?? ''),
        packing_fee: String(shipmentRow.packing_fee ?? defaultPackingFee ?? 0),
        clearing_fee: String(shipmentRow.landing_cost ?? defaultClearingFee ?? 0),
      });
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to assign Sea packing request.');
    } finally {
      setSaving(false);
    }
  };

  const openShipmentEditor = (shipment: LogisticsShipment) => {
    setSelectedShipmentId(shipment.id);
    setMessage(null);
    setError(null);
    setRejectionNote('');
    setCostForm({
      departure_date: shipment.departure_date || '',
      estimated_arrival: shipment.estimated_arrival || '',
      final_packed_cbm:
        shipment.final_packed_cbm != null ? String(shipment.final_packed_cbm) : '',
      packing_fee: String(shipment.packing_fee ?? 0),
      clearing_fee: String(shipment.landing_cost ?? 0),
      rate_per_cbm:
        shipment.rate_per_cbm != null
          ? String(shipment.rate_per_cbm)
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
    if (selectedShipment.freight_type !== 'sea') {
      setError('This admin view only costs Sea shipments.');
      return;
    }
    if (!shipmentAllowsCosting(selectedShipment.status)) {
      setError('Costing and finalize are locked after this shipment has been finalized.');
      return;
    }

    const cbm = Number(costForm.final_packed_cbm);
    const rate = Number(costForm.rate_per_cbm);
    const packingFee = Number(costForm.packing_fee);
    const clearingFee = Number(costForm.clearing_fee);

    if (!Number.isFinite(cbm) || cbm <= 0) {
      setError('Enter the final packed CBM. Do not auto-sum item CBM.');
      return;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      setError('Enter Sea rate per CBM (from published Sea fee or override).');
      return;
    }
    if (!Number.isFinite(packingFee) || packingFee < 0) {
      setError('Enter a valid packing fee (shipment-level).');
      return;
    }
    if (!Number.isFinite(clearingFee) || clearingFee < 0) {
      setError('Enter a valid clearing fee (shipment-level).');
      return;
    }

    const { freightCharge, totalAmountDue } = computeSeaShipmentTotalDue({
      finalPackedCbm: cbm,
      ratePerCbm: rate,
      packingFee,
      clearingFee,
    });

    setSaving(true);
    try {
      const payload: Record<string, any> = {
        departure_date: costForm.departure_date || null,
        estimated_arrival: costForm.estimated_arrival || null,
        final_packed_cbm: cbm,
        packing_fee: packingFee,
        landing_cost: clearingFee,
        rate_per_cbm: rate,
        freight_charge: freightCharge,
        total_amount_due: totalAmountDue,
        admin_shipment_remarks: costForm.admin_shipment_remarks.trim() || null,
        status: finalize ? 'finalized' : 'packed',
        updated_at: new Date().toISOString(),
      };
      if (finalize) payload.finalized_at = new Date().toISOString();

      const { error: updErr } = await supabase
        .from('shipments')
        .update(payload)
        .eq('id', selectedShipment.id)
        .eq('freight_type', 'sea');

      if (updErr) {
        setError(updErr.message || 'Failed to save Sea shipment costing.');
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
          ? `Shipment ${selectedShipment.shipment_code} finalized.`
          : `Shipment ${selectedShipment.shipment_code} costing saved (packed).`
      );
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to save Sea shipment.');
    } finally {
      setSaving(false);
    }
  };

  const progressSelectedShipment = async () => {
    setMessage(null);
    setError(null);
    if (!selectedShipment) {
      setError('Select a shipment first.');
      return;
    }
    if (selectedShipment.freight_type !== 'sea') {
      setError('This admin view only progresses Sea shipments.');
      return;
    }

    const next = nextShipmentProgressionStatus('sea', selectedShipment.status);
    if (!next || next === 'completed') {
      setError('No further Sea status change is available yet.');
      return;
    }
    if (!shipmentProgressionAllowed('sea', selectedShipment.status, next)) {
      setError('That status change is not allowed from the current status.');
      return;
    }

    setSaving(true);
    try {
      const { data, error: updErr } = await supabase
        .from('shipments')
        .update({
          status: next,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedShipment.id)
        .eq('status', selectedShipment.status)
        .eq('freight_type', 'sea')
        .select('id')
        .maybeSingle();

      if (updErr) {
        setError(updErr.message || 'Failed to update shipment status.');
        return;
      }
      if (!data?.id) {
        setError('Could not update status. The shipment may have already changed.');
        return;
      }

      setMessage(`Shipment ${selectedShipment.shipment_code} updated to ${next}.`);
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to update shipment status.');
    } finally {
      setSaving(false);
    }
  };

  const reviewSelectedPayment = async (decision: 'confirmed' | 'rejected') => {
    setMessage(null);
    setError(null);
    if (!selectedShipment || !user?.id) {
      setError('Select a shipment first.');
      return;
    }
    const payment = paymentByShipmentId[selectedShipment.id];
    if (!payment) {
      setError('No logistics payment has been submitted for this shipment.');
      return;
    }
    if (payment.status !== 'submitted') {
      setError('Only a submitted receipt can be confirmed or rejected.');
      return;
    }
    if (decision === 'rejected' && !rejectionNote.trim()) {
      setError('Enter a rejection note so the user can correct the receipt.');
      return;
    }

    const now = new Date().toISOString();
    setSaving(true);
    try {
      const { data, error: updErr } = await supabase
        .from('logistics_payments')
        .update({
          status: decision,
          confirmed_at: decision === 'confirmed' ? now : null,
          rejected_at: decision === 'rejected' ? now : null,
          rejection_note: decision === 'rejected' ? rejectionNote.trim() : null,
          reviewed_by: user.id,
          updated_at: now,
        })
        .eq('id', payment.id)
        .eq('status', 'submitted')
        .select('id')
        .maybeSingle();

      if (updErr) {
        setError(updErr.message || 'Failed to update payment.');
        return;
      }
      if (!data?.id) {
        setError('Could not update payment. It may have already been reviewed.');
        return;
      }

      setMessage(
        decision === 'confirmed'
          ? `Payment confirmed for ${selectedShipment.shipment_code}. Shipment remains available for pickup until you mark it completed.`
          : `Payment rejected for ${selectedShipment.shipment_code}.`
      );
      setRejectionNote('');
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to review payment.');
    } finally {
      setSaving(false);
    }
  };

  const completeSelectedShipment = async () => {
    setMessage(null);
    setError(null);
    if (!selectedShipment) {
      setError('Select a shipment first.');
      return;
    }
    if (selectedShipment.freight_type !== 'sea') {
      setError('This admin view only completes Sea shipments.');
      return;
    }
    const payment = paymentByShipmentId[selectedShipment.id] || null;
    if (!seaShipmentMayBeCompleted(selectedShipment.status, payment)) {
      setError('Payment must be confirmed before this shipment can be marked completed.');
      return;
    }

    setSaving(true);
    try {
      const { data, error: updErr } = await supabase
        .from('shipments')
        .update({
          status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedShipment.id)
        .eq('status', 'ready_for_pickup')
        .eq('freight_type', 'sea')
        .select('id')
        .maybeSingle();

      if (updErr) {
        setError(updErr.message || 'Failed to mark shipment completed.');
        return;
      }
      if (!data?.id) {
        setError('Could not update status. The shipment may have already changed.');
        return;
      }

      setMessage(`Shipment ${selectedShipment.shipment_code} marked as completed / picked up.`);
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to mark shipment completed.');
    } finally {
      setSaving(false);
    }
  };

  const pendingRequests = requests.filter((r) => !r.shipment_id);
  const selectedGoodsCbm = selectedShipment
    ? goodsCbmByShipmentId[selectedShipment.id] || 0
    : 0;
  const selectedGoods = selectedShipment
    ? shipmentGoodsById[selectedShipment.id] || []
    : [];

  return (
    <div className="p-5 bg-slate-900/90 rounded-2xl border border-sky-500/40 shadow-xl space-y-5">
      <div>
        <h2 className="text-sm font-bold text-sky-200 uppercase tracking-wider">
          Sea packing requests &amp; shipments
        </h2>
        <p className="text-xs text-purple-300/80 mt-1">
          Process Sea packing requests, enter final packed CBM, apply Sea rate + packing fee +
          clearing fee, then progress Shipped → In Transit → Arrived Nigeria → Pickup.
        </p>
        <Link
          to="/admin/shipping-requests"
          className="inline-block mt-2 text-xs font-bold text-amber-200 hover:text-amber-100 underline"
        >
          Open full Shipping Requests queue →
        </Link>
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

      <div className="space-y-2">
        <h3 className="text-xs font-bold text-amber-200 uppercase tracking-wider">
          Pending Sea packing requests
        </h3>
        {pendingRequests.length === 0 && !loading ? (
          <p className="text-xs text-purple-300/70">No pending Sea packing requests.</p>
        ) : (
          pendingRequests.map((req) => (
            <div
              key={req.id}
              className="p-3 rounded-xl border border-purple-500/30 bg-slate-950/50 space-y-2"
            >
              <p className="text-sm font-bold text-white">
                {req.km_id} · {req.goods.length} goods
              </p>
              <p className="text-[11px] text-purple-200">
                Pickup: {req.pickup?.name || '—'} · goods CBM{' '}
                {formatCbm(req.goods.reduce((sum, g) => sum + (g.cbm || 0), 0))}
              </p>
              {req.user_packing_instructions ? (
                <p className="text-[11px] text-amber-100/90">
                  Instructions: {req.user_packing_instructions}
                </p>
              ) : null}
              <button
                type="button"
                disabled={saving}
                onClick={() => void assignRequestToShipment(req)}
                className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-bold"
              >
                Create Sea shipment
              </button>
            </div>
          ))
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-bold text-cyan-200 uppercase tracking-wider">Sea shipments</h3>
        {shipments.length === 0 && !loading ? (
          <p className="text-xs text-purple-300/70">No Sea shipments yet.</p>
        ) : (
          <div className="space-y-2">
            {shipments.map((s) => {
              const pickup = warehouseById.get(s.nigeria_pickup_warehouse_id);
              const payment = paymentByShipmentId[s.id];
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openShipmentEditor(s)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    selectedShipmentId === s.id
                      ? 'border-sky-400 bg-sky-500/10'
                      : 'border-purple-500/30 bg-slate-950/50 hover:border-purple-400/50'
                  }`}
                >
                  <p className="text-sm font-bold text-white">{s.shipment_code}</p>
                  <p className="text-[11px] text-purple-200">
                    {s.km_id} · {s.status} · packed {formatCbm(s.final_packed_cbm)} · due{' '}
                    {formatMoney(s.total_amount_due)}
                  </p>
                  {s.status === 'ready_for_pickup' || s.status === 'completed' ? (
                    <p className="text-[11px] text-amber-100/90 mt-0.5">
                      {airAdminPickupPaymentLabel(payment)}
                    </p>
                  ) : payment ? (
                    <p className="text-[11px] text-amber-100/90 mt-0.5">
                      Payment: {logisticsPaymentStatusLabel(payment.status)}
                    </p>
                  ) : null}
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
              Sea cost &amp; progress — {selectedShipment.shipment_code}
            </h3>
            <p className="text-[11px] text-purple-300 mt-0.5">
              Current status: <span className="font-bold text-white">{selectedShipment.status}</span>
              . Final packed CBM is admin-entered (not the sum of item CBM).
            </p>
          </div>

          <div className="p-3 rounded-xl border border-sky-500/30 bg-sky-500/10 space-y-1">
            <p className="text-[10px] font-bold uppercase text-sky-200">Selected goods CBM</p>
            <p className="text-xs text-sky-50 font-extrabold">{formatCbm(selectedGoodsCbm)}</p>
            {selectedGoods.map((g) => (
              <p key={g.id} className="text-[11px] text-sky-100/90">
                {g.goods_description || 'Untitled'} · qty {g.quantity ?? '—'} · {formatCbm(g.cbm)}
              </p>
            ))}
            {linkedRequestInstructions ? (
              <p className="text-[11px] text-amber-100/90 pt-1">
                User packing instructions: {linkedRequestInstructions}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-amber-100/80">Departure date</span>
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
                Final packed CBM
              </span>
              <input
                type="number"
                min="0"
                step="0.001"
                value={costForm.final_packed_cbm}
                onChange={(e) => setCostForm((f) => ({ ...f, final_packed_cbm: e.target.value }))}
                className="w-full p-2 rounded-xl bg-slate-800 text-white border border-amber-500/30 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-amber-100/80">
                Sea rate per CBM (₦)
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={costForm.rate_per_cbm}
                onChange={(e) => setCostForm((f) => ({ ...f, rate_per_cbm: e.target.value }))}
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
                Clearing fee (₦)
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={costForm.clearing_fee}
                onChange={(e) => setCostForm((f) => ({ ...f, clearing_fee: e.target.value }))}
                className="w-full p-2 rounded-xl bg-slate-800 text-white border border-amber-500/30 text-sm"
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-[10px] font-bold uppercase text-amber-100/80">
                Admin shipment remarks
              </span>
              <textarea
                rows={2}
                value={costForm.admin_shipment_remarks}
                onChange={(e) =>
                  setCostForm((f) => ({ ...f, admin_shipment_remarks: e.target.value }))
                }
                className="w-full p-2 rounded-xl bg-slate-800 text-white border border-amber-500/30 text-sm resize-y"
              />
            </label>
          </div>

          {previewDue ? (
            <div className="text-xs text-emerald-50 space-y-0.5">
              <p>Freight charge: {formatMoney(previewDue.freightCharge)}</p>
              <p>
                Total amount due:{' '}
                <span className="font-extrabold">{formatMoney(previewDue.totalAmountDue)}</span>
              </p>
              <p className="text-[10px] text-emerald-200/80">
                = (final packed CBM × Sea rate) + packing fee + clearing fee
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving || !shipmentAllowsCosting(selectedShipment.status)}
              onClick={() => void saveShipmentCosting(false)}
              className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold"
            >
              Save packed / costing
            </button>
            <button
              type="button"
              disabled={saving || !shipmentAllowsCosting(selectedShipment.status)}
              onClick={() => void saveShipmentCosting(true)}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold"
            >
              Finalize shipment
            </button>
          </div>

          <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-200">
              Sea shipment progress
            </p>
            <p className="text-xs text-emerald-50">
              Current status: <span className="font-extrabold">{selectedShipment.status}</span>
            </p>
            {nextProgress ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void progressSelectedShipment()}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold"
              >
                {shipmentProgressionActionLabel(nextProgress)}
              </button>
            ) : selectedShipment.status === 'completed' ? (
              <p className="text-[11px] text-emerald-100/90">Completed / Picked Up.</p>
            ) : selectedShipment.status === 'ready_for_pickup' ? (
              (() => {
                const payment = paymentByShipmentId[selectedShipment.id] || null;
                const canComplete = seaShipmentMayBeCompleted(selectedShipment.status, payment);
                return (
                  <div className="space-y-2">
                    <p className="text-xs font-extrabold text-emerald-50">
                      {airAdminPickupPaymentLabel(payment)}
                    </p>
                    {canComplete ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void completeSelectedShipment()}
                          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold"
                        >
                          Mark as Completed
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void completeSelectedShipment()}
                          className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold"
                        >
                          Mark Picked Up
                        </button>
                      </div>
                    ) : (
                      <p className="text-[11px] text-emerald-100/90">
                        Payment must be confirmed before this shipment can be marked completed.
                      </p>
                    )}
                  </div>
                );
              })()
            ) : !shipmentAllowsCosting(selectedShipment.status) ? (
              <p className="text-[11px] text-emerald-100/90">
                No further Sea progress action from this status.
              </p>
            ) : (
              <p className="text-[11px] text-emerald-100/90">
                Finalize this shipment before marking it shipped.
              </p>
            )}
          </div>

          <div className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-200">
              Logistics payment
            </p>
            <p className="text-xs text-amber-50">
              Amount due:{' '}
              <span className="font-extrabold">{formatMoney(selectedShipment.total_amount_due)}</span>
            </p>
            {(() => {
              const payment = paymentByShipmentId[selectedShipment.id] || null;
              const receiptUrl = receiptUrlByShipmentId[selectedShipment.id];
              const atPickup =
                selectedShipment.status === 'ready_for_pickup' ||
                selectedShipment.status === 'completed';
              return (
                <div className="space-y-2">
                  <p className="text-xs font-extrabold text-amber-50">
                    {atPickup
                      ? airAdminPickupPaymentLabel(payment)
                      : payment
                        ? logisticsPaymentStatusLabel(payment.status)
                        : 'No payment yet'}
                  </p>
                  {!payment ? (
                    <p className="text-[11px] text-amber-100/90">
                      Users can upload a receipt once the shipment is available for pickup.
                    </p>
                  ) : (
                    <>
                      {receiptUrl ? (
                        <a
                          href={receiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block text-xs font-bold text-cyan-200 underline"
                        >
                          View uploaded receipt
                        </a>
                      ) : (
                        <p className="text-[11px] text-amber-100/80">No receipt file on this record.</p>
                      )}
                      {payment.status === 'submitted' ? (
                        <>
                          <label className="block space-y-1">
                            <span className="text-[10px] font-bold uppercase text-amber-100/80">
                              Rejection note (required to reject)
                            </span>
                            <textarea
                              rows={2}
                              value={rejectionNote}
                              onChange={(e) => setRejectionNote(e.target.value)}
                              className="w-full p-2 rounded-xl bg-slate-800 text-white border border-amber-500/30 text-sm resize-y"
                            />
                          </label>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void reviewSelectedPayment('confirmed')}
                              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold"
                            >
                              Confirm payment
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void reviewSelectedPayment('rejected')}
                              className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold"
                            >
                              Reject payment
                            </button>
                          </div>
                        </>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
