import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';
import {
  freightTypeFromReceivingWarehouse,
  normalizeWarehouse,
  type Warehouse,
} from '../types/warehouse';

type VerifiedUser = {
  user_id: string;
  km_id: string;
  full_name: string | null;
  email: string | null;
};

function todayInputValue() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const emptyForm = {
  date_received: todayInputValue(),
  goods_description: '',
  supplier_phone: '',
  tracking_number: '',
  quantity: '',
  weight_kg: '',
  admin_remarks: '',
};

export default function AdminAirFreight() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  const [kmInput, setKmInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifiedUser, setVerifiedUser] = useState<VerifiedUser | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [airChinaWarehouse, setAirChinaWarehouse] = useState<Warehouse | null>(null);
  const [warehouseLoadError, setWarehouseLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadAirChinaWarehouse = async () => {
      setWarehouseLoadError(null);
      const { data, error } = await supabase
        .from('warehouses')
        .select('*')
        .eq('code', 'CN-AIR')
        .eq('is_active', true)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        setAirChinaWarehouse(null);
        setWarehouseLoadError(
          error?.message ||
            'Air China Warehouse not found. Run supabase/warehouses.sql in Supabase.'
        );
        return;
      }

      setAirChinaWarehouse(normalizeWarehouse(data));
    };

    loadAirChinaWarehouse();
    return () => {
      cancelled = true;
    };
  }, []);

  const derivedFreightType = useMemo(() => {
    if (!airChinaWarehouse) return null;
    try {
      return freightTypeFromReceivingWarehouse(airChinaWarehouse);
    } catch {
      return null;
    }
  }, [airChinaWarehouse]);

  const canSave = useMemo(() => {
    return (
      Boolean(verifiedUser) &&
      Boolean(airChinaWarehouse) &&
      form.goods_description.trim().length > 0 &&
      form.date_received.trim().length > 0 &&
      form.quantity.trim().length > 0 &&
      form.weight_kg.trim().length > 0 &&
      !saving &&
      !uploadingPhoto
    );
  }, [verifiedUser, airChinaWarehouse, form, saving, uploadingPhoto]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const verifyKmId = async () => {
    const kmId = kmInput.trim().toUpperCase();
    setVerifyError(null);
    setSaveMessage(null);
    setSaveError(null);
    setVerifiedUser(null);

    if (!kmId) {
      setVerifyError('Enter a KM ID to verify.');
      return;
    }

    setVerifying(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, km_id, full_name, email')
        .eq('km_id', kmId)
        .maybeSingle();

      if (error) {
        setVerifyError(error.message || 'Could not verify KM ID.');
        return;
      }

      if (!data?.user_id || !data?.km_id) {
        setVerifyError(`No user found for KM ID "${kmId}".`);
        return;
      }

      setVerifiedUser({
        user_id: data.user_id,
        km_id: data.km_id,
        full_name: data.full_name ?? null,
        email: data.email ?? null,
      });
      setKmInput(data.km_id);
    } catch (err: any) {
      setVerifyError(err?.message || 'Could not verify KM ID.');
    } finally {
      setVerifying(false);
    }
  };

  const updateField = (key: keyof typeof emptyForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetFormKeepUser = () => {
    setForm({ ...emptyForm, date_received: todayInputValue() });
    setPhotoFile(null);
  };

  const uploadPhotoIfNeeded = async (): Promise<string | null> => {
    if (!photoFile) return null;

    setUploadingPhoto(true);
    try {
      const fileExt = photoFile.name.split('.').pop() || 'jpg';
      const fileName = `air-freight/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('payment-receipts')
        .upload(fileName, photoFile);

      if (uploadError) {
        throw new Error(uploadError.message || 'Photo upload failed.');
      }

      const { data: publicUrlData } = supabase.storage
        .from('payment-receipts')
        .getPublicUrl(fileName);

      return publicUrlData.publicUrl || null;
    } finally {
      setUploadingPhoto(false);
    }
  };

  const saveReceivedGoods = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMessage(null);
    setSaveError(null);

    if (!verifiedUser) {
      setSaveError('Verify a KM ID before saving.');
      return;
    }

    if (!airChinaWarehouse || derivedFreightType !== 'air') {
      setSaveError(
        'Air China Warehouse is required. Goods are saved as Air only (freight type is automatic).'
      );
      return;
    }

    const description = form.goods_description.trim();
    if (!description) {
      setSaveError('Goods description is required.');
      return;
    }

    const quantity = Number(form.quantity);
    const weightKg = Number(form.weight_kg);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setSaveError('Quantity must be a number greater than 0.');
      return;
    }
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      setSaveError('Weight (kg) must be a number greater than 0.');
      return;
    }

    setSaving(true);
    try {
      let photoUrl: string | null = null;
      try {
        photoUrl = await uploadPhotoIfNeeded();
      } catch (uploadErr: any) {
        setSaveError(
          uploadErr?.message ||
            'Photo upload failed. Record was not saved. You can retry without a photo.'
        );
        return;
      }

      const payload = {
        user_id: verifiedUser.user_id,
        km_id: verifiedUser.km_id,
        china_warehouse_id: airChinaWarehouse.id,
        date_received: form.date_received,
        goods_description: description,
        supplier_phone: form.supplier_phone.trim() || null,
        tracking_number: form.tracking_number.trim() || null,
        quantity,
        weight_kg: weightKg,
        photo_url: photoUrl,
        admin_remarks: form.admin_remarks.trim() || null,
        created_by: user?.id ?? null,
      };

      const { error } = await supabase.from('air_freight_goods').insert(payload);

      if (error) {
        setSaveError(error.message || 'Failed to save received goods.');
        return;
      }

      setSaveMessage(
        `Saved AIR goods for ${verifiedUser.km_id} at ${airChinaWarehouse.name}. Visible on the user's Air Freight page.`
      );
      resetFormKeepUser();
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save received goods.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-8 bg-gradient-to-br from-indigo-950 via-purple-950 to-slate-900 min-h-screen text-white rounded-3xl shadow-2xl border border-purple-500/30 my-8 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center pb-6 border-b border-purple-800/60 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold bg-gradient-to-r from-pink-400 via-purple-300 to-cyan-400 bg-clip-text text-transparent">
            Air Freight — Receive Goods
          </h1>
          <p className="text-xs md:text-sm text-purple-200 mt-1">
            Phase 1: enter a KM-ID and record goods received at the Air China Warehouse. Saved as Air
            goods only.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to="/admin"
            className="bg-purple-800/65 hover:bg-purple-700 text-cyan-200 px-4 py-2 rounded-xl text-xs font-semibold transition-all border border-purple-500/30 shadow"
          >
            ← Exchange Admin
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="bg-rose-700/80 hover:bg-rose-600 text-white px-4 py-2 rounded-xl text-xs font-semibold transition-all border border-rose-500/30 shadow"
          >
            Log Out
          </button>
        </div>
      </div>

      {/* CHINA RECEIVING WAREHOUSE (freight type automatic) */}
      <div className="p-5 bg-slate-900/90 rounded-2xl border border-cyan-500/40 shadow-xl space-y-2">
        <h2 className="text-sm font-bold text-cyan-200 uppercase tracking-wider">
          Receiving warehouse
        </h2>
        {airChinaWarehouse && derivedFreightType ? (
          <div className="text-xs space-y-1">
            <p className="font-bold text-white">{airChinaWarehouse.name}</p>
            <p className="text-cyan-100/90">
              Freight type: <span className="font-extrabold uppercase">{derivedFreightType}</span>{' '}
              (automatic — not selectable)
            </p>
            {airChinaWarehouse.address && (
              <p className="text-purple-200/80 whitespace-pre-line pt-1">{airChinaWarehouse.address}</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
            {warehouseLoadError || 'Loading Air China Warehouse...'}
          </p>
        )}
      </div>

      {/* KM ID VERIFY */}
      <div className="p-5 bg-slate-900/90 rounded-2xl border border-purple-500/40 shadow-xl space-y-4">
        <div>
          <h2 className="text-sm font-bold text-purple-200 uppercase tracking-wider">1. Find user by KM ID</h2>
          <p className="text-xs text-purple-300/80 mt-1">Search and verify before creating a received-goods record.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={kmInput}
            onChange={(e) => {
              setKmInput(e.target.value);
              setVerifiedUser(null);
              setVerifyError(null);
            }}
            placeholder="KM-XXXX"
            className="flex-1 p-2.5 rounded-xl bg-slate-800 text-white border border-purple-500/50 focus:outline-none focus:border-cyan-400 text-sm font-mono"
          />
          <button
            type="button"
            onClick={verifyKmId}
            disabled={verifying}
            className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-xs font-bold"
          >
            {verifying ? 'Verifying...' : 'Verify KM ID'}
          </button>
        </div>
        {verifyError && (
          <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
            {verifyError}
          </p>
        )}
        {verifiedUser && (
          <div className="text-xs bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-3 space-y-1">
            <p className="font-bold text-emerald-300">KM ID verified</p>
            <p className="text-emerald-100">
              <span className="font-mono font-bold">{verifiedUser.km_id}</span>
              {verifiedUser.full_name ? ` — ${verifiedUser.full_name}` : ''}
            </p>
            {verifiedUser.email && <p className="text-emerald-200/80">{verifiedUser.email}</p>}
          </div>
        )}
      </div>

      {/* RECEIVE FORM */}
      <form
        onSubmit={saveReceivedGoods}
        className={`p-5 bg-slate-900/90 rounded-2xl border border-purple-500/40 shadow-xl space-y-4 ${
          !verifiedUser ? 'opacity-60 pointer-events-none' : ''
        }`}
      >
        <div>
          <h2 className="text-sm font-bold text-purple-200 uppercase tracking-wider">2. Received goods details</h2>
          <p className="text-xs text-purple-300/80 mt-1">
            {verifiedUser
              ? `Creating record for ${verifiedUser.km_id}`
              : 'Verify a KM ID to enable this form.'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="font-bold text-purple-300">KM-ID</span>
            <input
              type="text"
              value={verifiedUser?.km_id || ''}
              readOnly
              className="w-full p-2.5 rounded-xl bg-slate-800/80 text-emerald-200 border border-purple-500/50 font-mono cursor-not-allowed"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-bold text-purple-300">Date received</span>
            <input
              type="date"
              value={form.date_received}
              onChange={(e) => updateField('date_received', e.target.value)}
              required
              className="w-full p-2.5 rounded-xl bg-slate-800 text-white border border-purple-500/50 focus:outline-none focus:border-cyan-400"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-bold text-purple-300">Quantity</span>
            <input
              type="number"
              min="1"
              step="1"
              value={form.quantity}
              onChange={(e) => updateField('quantity', e.target.value)}
              required
              className="w-full p-2.5 rounded-xl bg-slate-800 text-white border border-purple-500/50 focus:outline-none focus:border-cyan-400"
            />
          </label>
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="font-bold text-purple-300">Description *</span>
            <textarea
              value={form.goods_description}
              onChange={(e) => updateField('goods_description', e.target.value)}
              required
              rows={3}
              placeholder="Describe the received goods"
              className="w-full p-2.5 rounded-xl bg-slate-800 text-white border border-purple-500/50 focus:outline-none focus:border-cyan-400"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-bold text-purple-300">Supplier phone (optional)</span>
            <input
              type="text"
              value={form.supplier_phone}
              onChange={(e) => updateField('supplier_phone', e.target.value)}
              className="w-full p-2.5 rounded-xl bg-slate-800 text-white border border-purple-500/50 focus:outline-none focus:border-cyan-400"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-bold text-purple-300">Tracking number (optional)</span>
            <input
              type="text"
              value={form.tracking_number}
              onChange={(e) => updateField('tracking_number', e.target.value)}
              className="w-full p-2.5 rounded-xl bg-slate-800 text-white border border-purple-500/50 focus:outline-none focus:border-cyan-400"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-bold text-purple-300">Weight (kg)</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.weight_kg}
              onChange={(e) => updateField('weight_kg', e.target.value)}
              required
              className="w-full p-2.5 rounded-xl bg-slate-800 text-white border border-purple-500/50 focus:outline-none focus:border-cyan-400"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-bold text-purple-300">Photo upload (optional)</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs text-purple-200 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-purple-700 file:text-white file:text-xs file:font-semibold"
            />
            <span className="text-[10px] text-purple-400">
              Uses existing storage bucket (payment-receipts / air-freight/).
            </span>
          </label>
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="font-bold text-purple-300">Remarks (optional)</span>
            <textarea
              value={form.admin_remarks}
              onChange={(e) => updateField('admin_remarks', e.target.value)}
              rows={2}
              placeholder="Notes visible to the user"
              className="w-full p-2.5 rounded-xl bg-slate-800 text-white border border-purple-500/50 focus:outline-none focus:border-cyan-400"
            />
          </label>
        </div>

        {saveError && (
          <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
            {saveError}
          </p>
        )}
        {saveMessage && (
          <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2">
            {saveMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSave}
          className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-xs font-bold"
        >
          {saving || uploadingPhoto ? 'Saving...' : 'Save received goods'}
        </button>
      </form>
    </div>
  );
}
