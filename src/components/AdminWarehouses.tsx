import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { normalizeWarehouse, type Warehouse } from '../types/warehouse';

type WarehouseDraft = {
  name: string;
  address: string;
  is_active: boolean;
};

function emptyDraft(): WarehouseDraft {
  return { name: '', address: '', is_active: true };
}

/**
 * Admin-only warehouse editor for public.warehouses.
 * Does not create a second table. Codes/IDs stay read-only for Air workflow.
 */
export default function AdminWarehouses({ onSaved }: { onSaved?: () => void }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WarehouseDraft>(emptyDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadWarehouses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: loadErr } = await supabase
        .from('warehouses')
        .select('*')
        .order('country', { ascending: true })
        .order('code', { ascending: true });

      if (loadErr) {
        setError(loadErr.message || 'Could not load warehouses.');
        setWarehouses([]);
        return;
      }

      setWarehouses((data || []).map((row) => normalizeWarehouse(row)));
    } catch (err: any) {
      setError(err?.message || 'Could not load warehouses.');
      setWarehouses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWarehouses();
  }, [loadWarehouses]);

  const selected = warehouses.find((w) => w.id === selectedId) || null;

  const openWarehouse = (warehouse: Warehouse) => {
    setSelectedId(warehouse.id);
    setDraft({
      name: warehouse.name,
      address: warehouse.address || '',
      is_active: warehouse.is_active,
    });
    setMessage(null);
    setError(null);
  };

  const saveWarehouse = async () => {
    setMessage(null);
    setError(null);
    if (!selected) {
      setError('Select a warehouse first.');
      return;
    }

    const name = draft.name.trim();
    if (!name) {
      setError('Warehouse name is required.');
      return;
    }

    setSaving(true);
    try {
      const { data, error: updErr } = await supabase
        .from('warehouses')
        .update({
          name,
          address: draft.address.trim() || null,
          is_active: draft.is_active,
        })
        .eq('id', selected.id)
        .eq('code', selected.code)
        .select('id')
        .maybeSingle();

      if (updErr) {
        setError(updErr.message || 'Failed to save warehouse.');
        return;
      }
      if (!data?.id) {
        setError('Could not save warehouse. You may not have admin access.');
        return;
      }

      setMessage(`Saved ${selected.code}. Existing Air shipment links are unchanged.`);
      await loadWarehouses();
      onSaved?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to save warehouse.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-5 bg-slate-900/90 rounded-2xl border border-cyan-500/40 shadow-xl space-y-4">
      <div>
        <h2 className="text-sm font-bold text-cyan-200 uppercase tracking-wider">
          Warehouse management
        </h2>
        <p className="text-xs text-purple-300/80 mt-1">
          Edit name, address, and active status. Warehouse codes and IDs stay fixed so Air
          (CN-AIR, Nigeria pickups) keeps working.
        </p>
      </div>

      {loading ? <p className="text-xs text-purple-200">Loading warehouses…</p> : null}
      {error ? (
        <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2">
          {message}
        </p>
      ) : null}

      {warehouses.length === 0 && !loading ? (
        <p className="text-xs text-purple-300/70">No warehouses found.</p>
      ) : (
        <div className="space-y-2">
          {warehouses.map((warehouse) => (
            <button
              key={warehouse.id}
              type="button"
              onClick={() => openWarehouse(warehouse)}
              className={`w-full text-left p-3 rounded-xl border transition-all ${
                selectedId === warehouse.id
                  ? 'border-cyan-400 bg-cyan-500/10'
                  : 'border-purple-500/30 bg-slate-950/50 hover:border-purple-400/50'
              }`}
            >
              <p className="text-sm font-bold text-white">{warehouse.name}</p>
              <p className="text-[11px] text-cyan-100/90 mt-0.5">
                {warehouse.code} · {warehouse.country} · {warehouse.kind} · {warehouse.freight_type}
                {warehouse.is_active ? '' : ' · inactive'}
              </p>
            </button>
          ))}
        </div>
      )}

      {selected ? (
        <div className="p-4 rounded-xl border border-amber-500/40 bg-slate-950/70 space-y-3">
          <p className="text-xs font-bold text-amber-200">
            Edit {selected.code}
          </p>
          <p className="text-[11px] text-purple-200">
            Code, country, kind, and freight type are locked.
          </p>
          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase text-amber-100/80">Name</span>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="w-full p-2 rounded-xl bg-slate-800 text-white border border-amber-500/30 text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase text-amber-100/80">Address / details</span>
            <textarea
              rows={5}
              value={draft.address}
              onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
              className="w-full p-2 rounded-xl bg-slate-800 text-white border border-amber-500/30 text-sm resize-y"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-amber-50">
            <input
              type="checkbox"
              checked={draft.is_active}
              onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))}
            />
            Active (users only see active warehouses)
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveWarehouse()}
            className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold"
          >
            {saving ? 'Saving...' : 'Save warehouse'}
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-purple-300/80">Select a warehouse to edit.</p>
      )}
    </div>
  );
}
