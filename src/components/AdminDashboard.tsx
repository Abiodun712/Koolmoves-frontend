import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useNavigate } from 'react-router-dom';
import {useAuth } from '../contexts/AuthContext';
export default function AdminDashboard() {
    const [requests, setRequests] = useState<any[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [searchTerm, setSearchTerm] = useState<string>('');
const [rejectModal, setRejectModal] = useState(false);
const [rejectReason, setRejectReason] = useState("");
const [rejectRequest, setRejectRequest] = useState<any>(null);
    // Platform Status State (Active vs Not Active)
    const [platformStatus, setPlatformStatus] = useState<string>('active');
    const [updatingStatus, setUpdatingStatus] = useState<boolean>(false);
    const [exchangeRate, setExchangeRate] = useState('');
    const [savingRate, setSavingRate] = useState(false);
    const [rmbPaymentProof, setRmbPaymentProof] = useState('');
    const [uploadingRmbProof, setUploadingRmbProof] = useState(false);
    const [adminNote, setAdminNote] = useState('');
    const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
const navigate = useNavigate();
const { logout } = useAuth();

const handleLogout = async () => {
  await logout();
  navigate('/login');
};
    const saveExchangeRate = async () => {
        try {
            setSavingRate(true);

            const { error } = await supabase
                .from("site_settings")
                .upsert(
                    {
                        key: "exchange_rate",
                        value: exchangeRate,
                        updated_at: new Date().toISOString(),
                    },
                    {
                        onConflict: "key",
                    }
                );
            if (error) throw error;

            alert("Exchange rate updated successfully!");

        } catch (error) {
            console.error(error);
            alert("Failed to update exchange rate.");
        } finally {
            setSavingRate(false);
        }
    };
    // Modal / Selected User Profile View State
    const [selectedProfile, setSelectedProfile] = useState<any | null>(null);

    useEffect(() => {
        fetchAdminData();
    }, []);
    const fetchAdminData = async () => {
        setLoading(true);

        // Fetch requests
        const { data: reqData, error: reqError } = await supabase
            .from('exchange_requests')
            .select('*')
            .order('created_at', { ascending: false });

        if (!reqError && reqData) {
            setRequests(reqData);
        }

        // Fetch platform status settings from public.site_settings
        const { data: settingsData, error: settingsError } = await supabase
            .from('site_settings')
            .select('*')
            .eq('key', 'platform_status')
            .single();

        if (!settingsError && settingsData) {
            setPlatformStatus(settingsData.value || 'active');
        }
        // Fetch exchange rate settings from public.site_settings
        const { data: rateData } = await supabase
            .from('site_settings')
            .select('value')
            .eq('key', 'exchange_rate')
            .single();

        if (rateData) {
            setExchangeRate(rateData.value);
        }

        setLoading(false);
    };

    const handleTogglePlatformStatus = async (newStatus: string) => {
        setUpdatingStatus(true);

        // Upsert platform status setting into Supabase
        const { error } = await supabase
            .from('site_settings')
            .upsert([
                { key: 'platform_status', value: newStatus, updated_at: new Date().toISOString() }
            ], { onConflict: 'key' });

        if (!error) {
            setPlatformStatus(newStatus);
        } else {
            // Fallback if table doesn't have unique constraint set up properly
            const { error: updateError } = await supabase
                .from('site_settings')
                .update({ value: newStatus })
                .eq('key', 'platform_status');

            if (!updateError) {
                setPlatformStatus(newStatus);
            } else {
                alert('Failed to update platform status. Please check your Supabase site_settings table.');
            }
        }
        setUpdatingStatus(false);
    };

   const updateStatus = async (referenceNumber: string, newStatus: string, adminNote: string = "") => {
    console.log("Updating:", referenceNumber, newStatus);

    const { data, error } = await supabase
        .from('exchange_requests')
        .update({ status: newStatus,
            ...(newStatus ===
                "completed" && {
                    completed_at: new
                    Date(). toISOString()
                }),
                ...(newStatus === "rejected" && { admin_note: adminNote })
            })                      
            
         
        .eq('reference_number', referenceNumber)
        .select();

    console.log("Result:", data);
    console.log("Error:", error);

    if (!error && data && data.length > 0) {
        setRequests(
            requests.map(req =>
                req.reference_number === referenceNumber
                    ? { ...req, status: newStatus }
                    : req
            )
        );

        setSelectedRequest((prev: any) =>
            prev && prev.reference_number === referenceNumber
                ? { ...prev, status: newStatus }
                : prev
        );
    } else {
        alert("Failed to update status. No matching request found.");
    }
};

    const handleAdminReceiptUpload = async (
      e: React.ChangeEvent<HTMLInputElement>,
      referenceNumber: string
    ) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploadingRmbProof(true);
      try {
        const fileExt = file.name.split('.').pop();
        const fileName = Math.random().toString(36).substring(2) + '-' + Date.now() + '.' + fileExt;

        const { error: uploadError } = await supabase.storage
          .from('payment-receipts')
          .upload(fileName, file);

        if (uploadError) {
          alert('Upload failed: ' + uploadError.message);
          return;
        }

        const { data: publicUrlData } = supabase.storage
          .from('payment-receipts')
          .getPublicUrl(fileName);

        const { data, error } = await supabase
          .from('exchange_requests')
          .update({
            rmb_payment_proof: publicUrlData.publicUrl,
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('reference_number', referenceNumber)
          .select();

        if (!error && data && data.length > 0) {
          setRequests(requests.map(req =>
            req.reference_number === referenceNumber
              ? { ...req, status: 'completed', rmb_payment_proof: publicUrlData.publicUrl }
              : req
          ));
          setSelectedRequest((prev: any) =>
            prev && prev.reference_number === referenceNumber
              ? { ...prev, status: 'completed', rmb_payment_proof: publicUrlData.publicUrl }
              : prev
          );
          alert('Payment receipt uploaded — request marked as completed!');
        } else {
          alert('Failed to update request status.');
        }
      } catch (err: any) {
        alert('Error: ' + (err?.message || 'Unknown error'));
      } finally {
        setUploadingRmbProof(false);
      }
    };

    const filteredRequests = requests.filter(req => {
        const matchesStatus = filterStatus === 'all' || req.status?.toLowerCase() === filterStatus.toLowerCase();
        const matchesSearch =
            (req.reference_number && req.reference_number.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (req.bank_name && req.bank_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (req.account_number && req.account_number.includes(searchTerm)) ||
            (req.account_name && req.account_name.toLowerCase().includes(searchTerm.toLowerCase()));
        return matchesStatus && matchesSearch;
    });

    const getStatusBadge = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'completed':
                return <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full text-xs font-semibold">Completed</span>;
            case 'processing':
                return <span className="bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2.5 py-1 rounded-full text-xs font-semibold">Processing</span>;
            case 'rejected':
                return <span className="bg-rose-500/20 text-rose-400 border border-rose-500/30 px-2.5 py-1 rounded-full text-xs font-semibold">Rejected</span>;
            default:
                return <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-full text-xs font-semibold">Pending</span>;
        }
    };

    return (
        <div className="max-w-6xl mx-auto p-6 md:p-8 bg-gradient-to-br from-indigo-950 via-purple-950 to-slate-900 min-h-screen text-white rounded-3xl shadow-2xl border border-purple-500/30 my-8 space-y-6">

            {/* HEADER */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center pb-6 border-b border-purple-800/60 gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-extrabold bg-gradient-to-r from-pink-400 via-purple-300 to-cyan-400 bg-clip-text text-transparent">
                        Koolmovez Admin Dashboard
                    </h1>
                    <p className="text-xs md:text-sm text-purple-200 mt-1">Manage exchange requests, review user profiles, and control online availability status.</p>
                </div>
                <div className="flex items-center gap-2">
    <button
        onClick={fetchAdminData}
        className="bg-purple-800/65 hover:bg-purple-700 text-cyan-200 px-4 py-2 rounded-xl text-xs font-semibold transition-all border border-purple-500/30 shadow"
    >
        Refresh Data
    </button>
    <button
        onClick={handleLogout}
        className="bg-rose-700/80 hover:bg-rose-600 text-white px-4 py-2 rounded-xl text-xs font-semibold transition-all border border-rose-500/30 shadow"
    >
        Log Out
    </button>
</div>
            </div>

            {/* PLATFORM ONLINE / OFFLINE STATUS CONTROLLER BANNER */}

            <div className="p-5 bg-slate-900/90 rounded-2xl border border-purple-500/40 shadow-xl">
                <div className="text-xs uppercase tracking-wider text-purple-300 font-bold">
                    Current Exchange Rate
                </div>

                <div className="mt-3 flex items-center gap-3">
                    <input
                        type="number"
                        value={exchangeRate}
                        onChange={(e) => setExchangeRate(e.target.value)}
                        className="p-2 w-40 rounded-lg bg-slate-800 text-white border border-purple-500 focus:outline-none"
                        placeholder="Enter rate"
                    />

                    <button
                        type="button"
                        onClick={saveExchangeRate}
                        disabled={savingRate}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-semibold disabled:opacity-50"
                    >
                        {savingRate ? "Saving..." : "Save Rate"}
                    </button>
                </div>
            </div>

            <div className="p-5 bg-slate-900/90 rounded-2xl border border-purple-500/40 shadow-xl flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="space-y-1 text-center md:text-left">
                    <div className="text-xs uppercase tracking-wider text-purple-300 font-bold">
                        Platform Availability Status Controller
                    </div>

                    <div className="flex items-center justify-center md:justify-start gap-2 pt-1">
                        {platformStatus === "active" ? (
                            <span className="inline-flex items-center gap-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-full text-xs font-bold">
                                Admin Online (Processing Payments Normally)
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 bg-rose-500/20 text-rose-400 border border-rose-500/30 px-3 py-1 rounded-full text-xs font-bold">
                                Admin Currently Offline (Delayed Verification Mode)
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        disabled={updatingStatus}
                        onClick={() => handleTogglePlatformStatus("active")}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow ${platformStatus === "active"
                                ? "bg-emerald-600 text-white ring-2 ring-emerald-400"
                                : "bg-slate-950 text-slate-400 hover:bg-slate-800"
                            }`}
                    >
                        Set Active
                    </button>

                    <button
                        disabled={updatingStatus}
                        onClick={() => handleTogglePlatformStatus("inactive")}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow ${platformStatus === "inactive"
                                ? "bg-rose-600 text-white ring-2 ring-rose-400"
                                : "bg-slate-950 text-slate-400 hover:bg-slate-800"
                            }`}
                    >
                        Set Not Active
                    </button>
                </div>
            </div>

            {/* CONTROLS & FILTERS */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-900/80 p-4 rounded-2xl border border-purple-500/30">
                <input
                    type="text"
                    placeholder="Search by ref, bank, account name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full md:w-80 p-2.5 bg-slate-950 border border-purple-500/40 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
                />

                <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
                    {['all', 'pending', 'processing', 'completed', 'rejected'].map((status) => (
                        <button
                            key={status}
                            onClick={() => setFilterStatus(status)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-all border ${filterStatus === status
                                    ? 'bg-purple-700 text-cyan-200 border-cyan-400/50 shadow'
                                    : 'bg-slate-950 text-purple-300 border-purple-900/50 hover:bg-purple-950'
                                }`}
                        >
                            {status}
                        </button>
                    ))}
                </div>
            </div>

            {/* TRANSACTIONS TABLE */}
            <div className="bg-slate-900/80 rounded-2xl border border-purple-500/30 overflow-hidden shadow-xl">
                <div className="p-4 bg-slate-950/60 border-b border-purple-800/40 font-bold text-xs uppercase tracking-wider text-purple-300 flex justify-between items-center">
                    <span>Incoming Exchange Requests</span>
                    <span className="text-cyan-300 font-mono text-[11px]">{filteredRequests.length} Records</span>
                </div>

                {loading ? (
                    <div className="p-16 text-center text-purple-300 animate-pulse text-sm">Loading admin requests...</div>
                ) : filteredRequests.length === 0 ? (
                    <div className="p-16 text-center text-purple-400 text-sm">No exchange requests found.</div>
                ) : (
                    <div className="divide-y divide-purple-900/40 overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-950/40 text-[11px] text-purple-400 uppercase">
                                    <th className="p-4">Reference</th>
                                    <th className="p-4">Amounts</th>
                                    <th className="p-4">User Profile</th>
                                    <th className="p-4">Destination</th>
                                    <th className="p-4">Proofs</th>
                                    <th className="p-4">Status</th>
                                    <th className="p-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-purple-900/30 text-xs">
                                {filteredRequests.map((req) => (
                                    <tr key={req.id || req.reference_number} className="hover:bg-slate-950/50 transition-all">
                                        <td className="p-4 font-mono font-bold text-cyan-300">
                                            {req.reference_number}
                                            <span className="block text-[10px] text-purple-400 font-normal">{new Date(req.created_at || Date.now()).toLocaleDateString()}</span>
                                        </td>
                                        <td className="p-4 font-semibold">
                                            <span className="text-white">¥{Number(req.rmb_amount).toLocaleString()}</span>
                                            <span className="block text-emerald-300">₦{Number(req.total_naira || req.total_to_pay).toLocaleString()}</span>

                                            {req.exchange_rate_used && (
                                                <span className="block text-cyan-300 text-[10px] mt-1">
                                                    Rate: ₦{Number(req.exchange_rate_used).toLocaleString()} / RMB
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            <button
                                                onClick={() => setSelectedProfile(req)}
                                                className="bg-indigo-950 border border-indigo-500/40 text-cyan-300 hover:bg-indigo-900 px-3 py-1.5 rounded-xl font-medium transition-all shadow flex items-center gap-1.5"
                                            >
                                                <span> </span> View Profile
                                            </button>
                                        </td>
                                        <td className="p-4">
                                            <div className="font-bold text-white">{req.bank_name}</div>
                                            <div className="font-mono text-purple-200">{req.account_number}</div>
                                            <div className="text-[10px] text-purple-400">{req.account_name}</div>
                                        </td>
                                        <td className="p-4 space-x-2">
                                            {req.receipts && (
                                                <a href={req.receipts} target="_blank" rel="noreferrer" className="text-cyan-300 underline text-[11px]">Naira Proof</a>
                                            )}
                                            {req.receiver_image && (
                                                <a href={req.receiver_image} target="_blank" rel="noreferrer" className="text-pink-300 underline text-[11px]">Receiver QR</a>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            {getStatusBadge(req.status)}
                                        </td>
                                        <td className="p-4 text-right space-x-2">
                                            <button
                                                onClick={() => setSelectedRequest(req)}
                                                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded-lg font-semibold text-[11px] shadow transition-all"
                                            >
                                                Process
                                            </button>
                                            <button
                                                disabled={req.status === 'completed' || req.status === 'rejected'}
                                                onClick={() => {setRejectRequest(req); setRejectModal(true);}}
                                                className="bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1 rounded-lg font-semibold text-[11px] shadow transition-all"
                                            >
                                                Reject
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* USER PROFILE MODAL */}
            {selectedProfile && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
                    <div className="bg-slate-900 border border-purple-500/40 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5">
                        <div className="flex justify-between items-center border-b border-purple-800/60 pb-3">
                            <h3 className="text-base font-bold text-cyan-300 flex items-center gap-2">
                                <span> </span> Attached User Profile
                            </h3>
                            <button
                                onClick={() => setSelectedProfile(null)}
                                className="text-purple-400 hover:text-white font-bold text-lg"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="space-y-3 text-xs">
                            <div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
                                <span className="text-[10px] text-purple-400 block">Account Holder / Name</span>
                                <span className="font-bold text-white text-sm mt-0.5 block">{selectedProfile.account_name || 'Ismaila Abiodun Ogundepo'}</span>
                            </div>
                            <div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
                                <span className="text-[10px] text-purple-400 block">User Email / Contact</span>
                                <span className="font-bold text-cyan-300 mt-0.5 block">{selectedProfile.user_email || 'Not provided'}</span>
                            </div>
                            <div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
                                <span className="text-[10px] text-purple-400 block">KoolMovez User ID </span>
                                <span className="font-mono font-bold text-pink-300 mt-0.5 block">{selectedProfile.km_id || "Not Generated"}</span>
                            </div><div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
    <span className="text-[10px] text-purple-400 block">
        Transaction Reference
    </span>
    <span className="font-mono font-bold text-yellow-300 mt-0.5 block">
        {selectedProfile.reference_number || "No Transaction"}
    </span>
</div>
                            <div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
                                <span className="text-[10px] text-purple-400 block">Receiving Destination</span>
                                <span className="font-bold text-white mt-0.5 block">{selectedProfile.bank_name} - {selectedProfile.account_number}</span>
                            </div>
                        </div>

                        <button
                            onClick={() => setSelectedProfile(null)}
                            className="w-full py-2.5 bg-purple-700 hover:bg-purple-600 text-white font-bold rounded-xl text-xs shadow transition-all"
                        >
                            Close Profile
                        </button>

                    </div>
                </div>
            )}


 {selectedRequest && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
    <div className="bg-slate-900 border border-purple-500/40 rounded-3xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl">

      <div className="flex justify-between items-center border-b border-purple-800/50 pb-3 mb-5">
        <h2 className="text-lg font-bold text-cyan-300">
          Process Exchange Request
        </h2>

        <button
          onClick={() => setSelectedRequest(null)}
          className="text-purple-400 hover:text-white text-xl"
        >
          ✕
        </button>
      </div>


      <div className="space-y-3 text-sm">

        <div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
          <span className="text-xs text-purple-400 block">
            Transaction Reference
          </span>
          <span className="font-bold text-white">
            {selectedRequest.transaction_ref || "Not Provided"}
          </span>
        </div>


        <div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
          <span className="text-xs text-purple-400 block">
            Amount To Pay
          </span>
          <span className="font-bold text-emerald-300 text-lg">
            ₦{Number(selectedRequest.total_to_pay || 0).toLocaleString()}
            <div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
  <span className="text-xs text-purple-400 block">
    RMB Amount
  </span>

  <span className="font-bold text-cyan-300 text-lg">
    ¥{Number(selectedRequest.rmb_amount || 0).toLocaleString()}
  </span>
</div>


<div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
  <span className="text-xs text-purple-400 block">
    Exchange Rate
  </span>

  <span className="font-bold text-white">
    ₦{Number(selectedRequest.exchange_rate_used || 0).toLocaleString()} / RMB
  </span>
</div>
          </span>
        </div>


        <div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
          <span className="text-xs text-purple-400 block">
            Recipient Name
          </span>
          <span className="font-bold text-white">
            {selectedRequest.recipient_name || "Not Provided"}
          </span>
        </div>


        <div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
          <span className="text-xs text-purple-400 block">
            Account Number
          </span>
          <span className="font-mono font-bold text-cyan-300">
            {selectedRequest.account_number || "Not Provided"}
          </span>
        </div>


        <div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
          <span className="text-xs text-purple-400 block">
            Bank Name
          </span>
          <span className="font-bold text-white">
            {selectedRequest.bank_name || "Not Provided"}
          </span>
        </div>


        <div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
          <span className="text-xs text-purple-400 block">
            Status
          </span>
{getStatusBadge(selectedRequest.status)} 
</div>
        
    
        {selectedRequest.completed_at && (
        <div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
  <span className="text-xs text-purple-400 block">
    Completed At
  </span>

  <span className="font-bold text-white">
  {new Date(selectedRequest.completed_at).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Singapore",
  })}
</span> 
</div>
        )}


{selectedRequest.status === "rejected" && selectedRequest.admin_note && (
  <div className="p-3 bg-slate-950 rounded-xl border border-red-900/50">
    <span className="text-xs text-red-400 block">
      Rejection Reason
    </span>

    <span className="font-bold text-white">
      {selectedRequest.admin_note}
    </span>
  </div>
)}
        <div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
          <span className="text-xs text-purple-400 block mb-1">
            Payment Receipt
          </span>
          <div className="p-3 bg-slate-950 rounded-xl border border-purple-900/50">
  <span className="text-xs text-purple-400 block mb-1">
    RMB Receiving QR Code
  </span>

  {selectedRequest.receiver_image ? (
    <a
      href={selectedRequest.receiver_image}
      target="_blank"
      rel="noreferrer"
      className="text-pink-300 underline font-semibold"
    >
      View RMB QR Code
    </a>
  ) : (
    <span className="text-gray-400">
      No QR code uploaded
    </span>
  )}
</div>

          {selectedRequest.receipts ? (
            <a
              href={selectedRequest.receipts}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300 underline font-semibold"
            >
              View Receipt
            </a>
          ) : (
            <span className="text-gray-400">
              No receipt uploaded
            </span>
          )}
        </div>

        {selectedRequest.status === "processing" && (
          <div className="p-3 bg-slate-950 rounded-xl border border-emerald-900/50 space-y-2">
            <span className="text-xs text-emerald-400 block">
              Upload RMB Payment Receipt to Mark as Completed
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleAdminReceiptUpload(e, selectedRequest.reference_number)}
              className="w-full p-2 bg-white border border-slate-700 rounded-lg text-xs text-slate-900 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-emerald-700 file:text-white hover:file:bg-emerald-600"
            />
            {uploadingRmbProof && (
              <p className="text-[11px] text-cyan-300 font-semibold">Uploading receipt...</p>
            )}
          </div>
        )}

        {selectedRequest.status === "completed" && selectedRequest.rmb_payment_proof && (
          <div className="p-3 bg-slate-950 rounded-xl border border-emerald-900/50">
            <span className="text-xs text-emerald-400 block mb-1">
              RMB Payment Receipt (Admin Upload)
            </span>
            <a
              href={selectedRequest.rmb_payment_proof}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-300 underline font-semibold"
            >
              View Uploaded Receipt
            </a>
          </div>
        )}

      </div>


      <div className="flex gap-3 mt-6">
      <button
  disabled={
    selectedRequest.status !== "pending"
  }
  onClick={() => updateStatus(selectedRequest.reference_number, "processing")}
  className={`flex-1 py-2 rounded-xl font-bold text-sm ${
    selectedRequest.status !== "pending"
      ? "bg-gray-600 text-gray-300 cursor-not-allowed"
      : "bg-cyan-600 hover:bg-cyan-500 text-white"
  }`}
>
  {selectedRequest.status === "pending"
    ? "Mark as Processing"
    : selectedRequest.status === "processing"
    ? "Processing"
    : selectedRequest.status === "completed"
    ? "Completed"
    : "Rejected"}
</button>


<button
  disabled={
    selectedRequest.status === "completed" ||
    selectedRequest.status === "rejected"
  }
  onClick={() => {setRejectRequest(selectedRequest); setRejectModal(true);}}
  className={`flex-1 py-2 rounded-xl font-bold text-sm ${
    selectedRequest.status === "completed" ||
    selectedRequest.status === "rejected"
      ? "bg-gray-600 text-gray-300 cursor-not-allowed"
      : "bg-rose-600 hover:bg-rose-500 text-white"
  }`}
>
  {selectedRequest.status === "completed"
    ? "Completed"
    : selectedRequest.status === "rejected"
    ? "Rejected"
    : "Reject"}
</button>

      </div>


      <button
        onClick={() => setSelectedRequest(null)}
        className="w-full mt-3 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-xl font-bold text-sm"
      >
        Close
      </button>

    </div>
  </div>
)}
   
{rejectModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">

    <div className="bg-slate-900 border border-rose-500/40 rounded-2xl p-6 w-full max-w-md">

      <h2 className="text-lg font-bold text-rose-300 mb-4">
        Reject Exchange Request
      </h2>

      <textarea
        value={rejectReason}
        onChange={(e) => setRejectReason(e.target.value)}
        placeholder="Enter rejection reason..."
        className="w-full bg-slate-950 border border-purple-700 rounded-xl p-3 text-white h-28"
      />

      <div className="flex gap-3 mt-5">

        <button
          onClick={() => {
            updateStatus(
              rejectRequest.reference_number,
              "rejected",
              rejectReason
            );
            setRejectModal(false);
            setRejectReason("");
          }}
          className="flex-1 bg-rose-600 hover:bg-rose-500 text-white py-2 rounded-xl font-bold"
        >
          Confirm Reject
        </button>

        <button
          onClick={() => setRejectModal(false)}
          className="flex-1 bg-slate-700 text-white py-2 rounded-xl font-bold"
        >
          Cancel
        </button>

      </div>

    </div>

  </div>
)}
</div>
    );
}