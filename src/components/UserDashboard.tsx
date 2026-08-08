import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext'; 
export default function UserDashboard() {
  const  [currentView, setCurrentView] = useState<string>( 'form');
  const [bankName, setBankName] = useState("") ;
const [userKmid, setUserKmId] = useState( '');
const [userProfile, setUserProfile] = useState<any>(null);
  const [rmbAmount, setRmbAmount] = useState<string>('');
  const [nairaTotal, setNairaTotal] = useState<number>(0);
  
  const [timeLeft, setTimeLeft] = useState<number>(600);
  const [isLocked, setIsLocked] = useState<boolean>(true);
  
  const [adminBanks, setAdminBanks] = useState<any[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Admin General System Status State
  const [systemStatus, setSystemStatus] = useState<{ is_online: boolean; notice: string; exchange_rate: number | null}>({
    is_online: true,
    notice: 'All exchange networks are operating smoothly.',
    exchange_rate: null
  });
  const [loadingStatus, setLoadingStatus] = useState<boolean>(true);

  const [paymentProof, setPaymentProof] = useState<string>('');
  const [uploadingPayment, setUploadingPayment] = useState<boolean>(false);

  const [recipientName, setRecipientName] = useState<string>('');
  const [accountType, setAccountType] = useState<string>('Alipay');
  const [rmbAccountNumber, setRmbAccountNumber] = useState<string>('');
  
  const [qrCodeProof, setQrCodeProof] = useState<string>('');
  const [uploadingQr, setUploadingQr] = useState<boolean>(false);
  
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string; details?: string } | null>(null);

  const [myRequests, setMyRequests] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  const [messages, setMessages] = useState<any[]>([
    { sender: 'support', text: 'Hello! Welcome to KoolMovez support. How can we help you with your exchange today?', time: 'Just now' }
  ]);
  const [newMessage, setNewMessage] = useState<string>('');
const navigate = useNavigate();
const { logout } = useAuth();
const handleLogout = async () => { await logout(); navigate('/login'); }
  const exchangeRate = systemStatus.exchange_rate; 

  useEffect(() => {
    if (timeLeft > 0 && isLocked) {
      const timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
      return () => clearInterval(timer);
    } else if (timeLeft === 0) {
      setIsLocked(false);
    }
  }, [timeLeft, isLocked]);

  useEffect(() => {
    fetchAdminBanks();
    fetchUserHistory();
    fetchSystemStatus();
    fetchUserProfile();

  }, []);

  const fetchUserProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (!error && data) {
      setUserProfile(data);
      setUserKmId(data.km_id || '');
    }
  };

  const fetchAdminBanks = async () => {
    const { data, error } = await supabase
      .from('admin_banks')
      .select('*')
      .eq('status', 'active');

    if (!error && data && data.length > 0) {
      setAdminBanks(data.slice(0, 2));
    } else {
      setAdminBanks([
        { bank_name: 'Guaranty Trust Bank (GTB)', account_number: '0123456789', account_name: 'KoolMoves Global Services' },
        { bank_name: 'Moniepoint MFB', account_number: '9876543210', account_name: 'KoolMoves Fintech' }
      ]);
    }
  };

  const fetchSystemStatus = async () => {
    setLoadingStatus(true);
    try {
      const { data, error } = await supabase
        .from('site_settings')
        .select('key, value')
        .in('key', ['platform_status', 'exchange_rate', 'offline_msg']);

      if (!error && data) {
        const settingsMap: Record<string, string> = {};
        data.forEach((row: any) => { settingsMap[row.key] = row.value; });

        const status = settingsMap.platform_status || 'active';

        setSystemStatus({
          is_online: status === 'active',
          notice: status === 'active'
            ? 'All exchange networks are operating smoothly.'
            : (settingsMap.offline_msg || 'System is currently offline.'),
          exchange_rate: settingsMap.exchange_rate? parseFloat(settingsMap.exchange_rate)
   : null      
    });
      }
    } catch (err) {
      console.log('Using default system status indicators.');
    } finally {
      setLoadingStatus(false);
    }
  };

  const fetchUserHistory = async () => {
    setLoadingHistory(true);
    const { data, error } = await supabase
      .from('exchange_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setMyRequests(data);
    }
    setLoadingHistory(false);
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2500);
  };

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleRmbChange = (val: string) => {
    const sanitized = val.replace(/[^0-9.]/g, '');
    setRmbAmount(sanitized);
    const num = parseFloat(sanitized);
    if (!isNaN(num) && exchangeRate) {
      setNairaTotal(num * exchangeRate);
    } else {
      setNairaTotal(0);
    }
  };

  const handleAlphanumericChange = (val: string, setter: (v: string) => void) => {
    const sanitized = val.replace(/[^a-zA-Z0-9\s]/g, '');
    setter(sanitized);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'payment' | 'qr') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (type === 'payment') setUploadingPayment(true);
    else setUploadingQr(true);

    try {
      const fileExt = file.name.split('.').pop();
      const randomStr = Math.random().toString(36).substring(2);
      const fileName = randomStr + '-' + Date.now() + '.' + fileExt;
      const filePath = fileName;

      let { error: uploadError } = await supabase.storage
        .from('payment-receipts')
        .upload(filePath, file);

      if (uploadError) {
        const fallbackAttempt = await supabase.storage
          .from('receipts')
          .upload(filePath, file);
        uploadError = fallbackAttempt.error;
      }

      if (uploadError) {
        console.error('Storage upload error:', uploadError);
        alert('Image upload failed: ' + uploadError.message);
      } else {
        const { data: publicUrlData } = supabase.storage
          .from('payment-receipts')
          .getPublicUrl(filePath);

        if (type === 'payment') {
          setPaymentProof(publicUrlData.publicUrl);
        } else {
          setQrCodeProof(publicUrlData.publicUrl);
        }
      }
    } catch (err: any) {
      console.error('Upload exception:', err);
      alert('File upload error: ' + (err?.message || 'Unknown error'));
    } finally {
      if (type === 'payment') setUploadingPayment(false);
      else setUploadingQr(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rmbAmount) return;

    setSubmitting(true);
    setNotification(null);

    const referenceNumber = 'KMX-' + Math.floor(100000 + Math.random() * 900000);

    const { data: { user } } = await supabase.auth.getUser();

    try {
      if (!user) {
        throw new Error("User not logged in");
      }

      if (!userProfile) {
        throw new Error("KM ID not found");
      }

      const payload: any = {
        user_id: user.id,
        km_id: userKmid,
        user_email: userProfile.email,
        user_phone: userProfile.phone,
        reference_number: referenceNumber,
        rmb_amount: parseFloat(rmbAmount),
        naira_amount: nairaTotal,
        total_to_pay: nairaTotal,
        exchange_rate_used: exchangeRate,
        status: 'pending'
      };

      if (paymentProof) payload.receipts = paymentProof;
      if (qrCodeProof) payload.qr_code = qrCodeProof;
      if (rmbAccountNumber.trim()) payload.rmb_account_number = rmbAccountNumber.trim();
      if (recipientName.trim()) payload.recipient_name = recipientName.trim();
      if (bankName.trim()) payload.bank_name = bankName.trim();

      let { error } = await supabase
        .from('exchange_requests')
        .insert([payload]);

      if (error && error.message && error.message.includes("recipient_name")) {
        delete payload.recipient_name;
        const retryResult = await supabase
          .from('exchange_requests')
          .insert([payload]);
        error = retryResult.error;
      }

      if (error) {
        console.error('Supabase DB Insert Error:', error);
        const errString = error.message || JSON.stringify(error);
        setNotification({
          type: 'error',
          message: 'Database insertion rejected.',
          details: errString
        });
        alert('Submission Error: ' + errString);
      } else {
        const successText = `Exchange request submitted successfully! Tracking Ref: ${referenceNumber}`;
        setNotification({
          type: 'success',
          message: successText
        });
        
        window.alert(successText);

        setRmbAmount('');
        setRecipientName('');
        setRmbAccountNumber('');
        setQrCodeProof('');
        setPaymentProof('');
        setNairaTotal(0);
        fetchUserHistory();
        setCurrentView('history');
      }
    } catch (err: any) {
      console.error('Unexpected submission exception:', err);
      const errString = err?.message || 'Unknown error';
      setNotification({
        type: 'error',
        message: 'An unexpected runtime error occurred.',
        details: errString
      });
      alert('Error: ' + errString);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const userMsg = { sender: 'user', text: newMessage.trim(), time: 'Just now' };
    setMessages(prev => [...prev, userMsg]);
    setNewMessage('');

    setTimeout(() => {
      setMessages(prev => [
        ...prev, 
        { sender: 'support', text: 'Thank you for reaching out. An admin agent is reviewing your message and will update you shortly.', time: 'Just now' }
      ]);
    }, 1000);
  };

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      {/* HEADER & TOP BAR */}
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900">User Dashboard</h2>
          <p className="text-xs text-gray-500 mt-0.5">Manage your currency exchange, profile, and support messages.</p>
        </div>
        <div className="flex items-center gap-2">
  <div className="bg-gray-900 text-white px-3 py-1.5 rounded-xl text-xs font-bold">
    ID: {userKmid || 'Loading...'}
  </div>
  <button
    type="button"
    onClick={handleLogout}
    className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
  >
    Log Out
  </button>
</div>      </div>

      {/* ADMIN GENERAL SYSTEM STATUS BANNER */}
      <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-sm transition-all ${
        systemStatus.is_online 
          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900' 
          : 'bg-amber-50/80 border-amber-200 text-amber-900'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full animate-pulse ${systemStatus.is_online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider">Admin System Status:</span>
              <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                systemStatus.is_online ? 'bg-emerald-200 text-emerald-800' : 'bg-amber-200 text-amber-800'
              }`}>
                {systemStatus.is_online ? ' ONLINE / PROCESSING' : ' MAINTENANCE / DELAYED'}
              </span>
            </div>
            <p className="text-xs mt-0.5 font-medium opacity-90">{systemStatus.notice}</p>
          </div>
        </div>
        <button 
          type="button"
          onClick={fetchSystemStatus}
          className="text-[10px] bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 font-bold px-2.5 py-1 rounded-lg shadow-xs"
        >
          Refresh Status
        </button>
      </div>

      {/* FULL NAVIGATION TAB BAR */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
        <button
          type="button"
          onClick={() => setCurrentView('form')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            currentView === 'form' 
              ? 'bg-[#10B981] text-white shadow-sm' 
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <span> </span> Home / New Exchange
        </button>

        <button
          type="button"
          onClick={() => {
            setCurrentView('history');
            fetchUserHistory();
          }}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            currentView === 'history' 
              ? 'bg-[#10B981] text-white shadow-sm' 
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <span> </span> My Requests ({myRequests.length})
        </button>

        <button
          type="button"
          onClick={() => setCurrentView('profile')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            currentView === 'profile' 
              ? 'bg-[#10B981] text-white shadow-sm' 
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <span> </span> Profile
        </button>

        <button
          type="button"
          onClick={() => setCurrentView('chat')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            currentView === 'chat' 
              ? 'bg-[#10B981] text-white shadow-sm' 
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <span> </span> Chat / Support
        </button>
      </div>

      {/* VIEW 1: HOME / NEW EXCHANGE REQUEST FORM */}
      {currentView === 'form' && (
        <div className="p-5 bg-white rounded-2xl border border-[#E5E7EB] shadow-sm space-y-6">
          <div>
            <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
              <span> </span> New RMB Exchange Request
            </h3>
            <p className="text-xs text-gray-600 mt-1">Fill out the details below to complete your exchange request.</p>
          </div>

          {notification && (
            <div className={`p-4 rounded-xl border text-xs flex flex-col gap-1.5 shadow-sm transition-all ${
              notification.type === 'success' 
                ? 'bg-[#10B981]/10 border-[#10B981]/40 text-[#065F46]' 
                : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              <div className="flex items-center gap-2 font-bold text-sm">
                <span>{notification.type === 'success' ? ' ' : ' '}</span>
                <span>{notification.type === 'success' ? 'Success Notification' : 'Action Required / Error Notice'}</span>
              </div>
              <p className="font-semibold">{notification.message}</p>
              {notification.details && (
                <p className="font-mono text-[11px] bg-white/80 p-2 rounded border border-current/20 overflow-x-auto mt-1">
                  {notification.details}
                </p>
              )}
            </div>
          )}

          {/* RATE LOCKER & COUNTDOWN BANNER */}
          <div className="p-3 bg-[#0F172A] text-white rounded-xl flex flex-col sm:flex-row justify-between items-center gap-2 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span> </span> 
              <span>Exchange Rate Locked: <strong className="text-[#10B981]">1 RMB = ₦{exchangeRate}</strong></span>
            </div>
            <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1 rounded-lg text-xs font-mono font-bold">
              <span> </span> 
              {isLocked ? <span>Expires in: {formatTime(timeLeft)}</span> : <span className="text-red-400">Rate Expired</span>}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* SECTION 1: AMOUNT */}
            <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-[#E5E7EB] space-y-3">
              <h4 className="text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
                <span> </span> Enter Amount
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-gray-700">RMB Amount (¥)</label>
                  <input 
                    type="text"
                    required
                    placeholder="e.g. 1000"
                    value={rmbAmount}
                    onChange={(e) => handleRmbChange(e.target.value)}
                    className="w-full p-3 bg-white border border-[#E5E7EB] rounded-xl text-xs font-bold text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#10B981]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-gray-700">Total Naira to Pay (₦)</label>
                  <input 
                    type="text"
                    disabled
                    value={`₦${nairaTotal.toLocaleString()}`}
                    className="w-full p-3 bg-gray-100 border border-[#E5E7EB] rounded-xl text-xs font-bold text-[#10B981] cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            {/* SECTION 2: ADMIN BANK ACCOUNTS */}
            <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-[#E5E7EB] space-y-3">
              <h4 className="text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
                <span> </span> Pay Naira Into Any Admin Account Below
              </h4>
    <p className="text-[11px] text-gray-600">
  {exchangeRate ? (
    <>
      Transfer{" "}
      <strong className="text-[#10B981]">
        ₦{nairaTotal.toLocaleString()}
      </strong>{" "}
      to one of the two accounts below:
    </>
  ) : (
    <strong className="text-red-500">
      Exchange rate temporarily unavailable. Please try again.
    </strong>
  )}
</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {adminBanks.slice(0, 2).map((bank, index) => (
                  <div key={index} className="p-3 bg-white rounded-xl border border-[#E5E7EB] space-y-2 shadow-sm relative">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] bg-[#0F172A] text-white px-2 py-0.5 rounded font-bold">Account Option {index + 1}</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(bank.account_number, index)}
                        className="text-[10px] bg-gray-100 hover:bg-[#10B981] hover:text-white text-gray-700 font-bold px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 shadow-xs"
                      >
                        <span>{copiedIndex === index ? ' Copied!' : ' Copy Number'}</span>
                      </button>
                    </div>
                    <div>
                      <p className="text-xs font-extrabold text-[#111827] pt-1">{bank.bank_name}</p>
                      <p className="text-xs font-mono font-bold text-[#10B981] tracking-wider pt-0.5">{bank.account_number}</p>
                      <p className="text-[11px] text-gray-500 truncate pt-0.5">{bank.account_name}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* SECTION 3: PAYMENT PROOF */}
            <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-[#E5E7EB] space-y-3">
              <h4 className="text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
                <span> </span> Upload Proof of Payment
              </h4>
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-gray-700">Upload Receipt Image / File</label>
                <input 
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleFileUpload(e, 'payment')}
                  className="w-full p-2 bg-white border border-[#E5E7EB] rounded-xl text-xs text-[#111827] file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-[#0F172A] file:text-white hover:file:bg-[#1E293B]"
                />
                {uploadingPayment && <p className="text-[11px] text-blue-600 font-semibold">Uploading payment proof image...</p>}
                {paymentProof && (
                  <div className="space-y-1">
                    <p className="text-[11px] text-emerald-600 font-bold"> Receipt image uploaded successfully!</p>
                    <input 
                      type="text"
                      readOnly
                      value={paymentProof}
                      className="w-full p-2 bg-gray-50 border border-[#E5E7EB] rounded-lg text-[10px] text-gray-500 truncate"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* SECTION 4: RMB RECEIVING DETAILS & QR CODE */}
            <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-[#E5E7EB] space-y-3">
              <h4 className="text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
                <span> </span> RMB Receiving Account / Wallet & QR Code
              </h4>

              <div className="space-y-3">
                <div className="space-y-1">
  <label className="text-[11px] text-gray-600 font-medium">
    Bank / Wallet Name <span className="text-gray-400 font-normal">(Optional)</span>
  </label>
  <input
    type="text"
    placeholder="ICBC, Bank of China, Alipay, Wechat pay"
    value={bankName}
    onChange={(e) => setBankName(e.target.value)}
    className="w-full p-2.5 bg-white border border-[#E5E7EB] rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-blue-500"
  />
</div>

                <div className="space-y-1">
                  <label className="text-[11px] text-gray-600 font-medium">Recipient Name (Chinese/English) <span className="text-gray-400 font-normal">(Optional)</span></label>
                  <input 
                    type="text"
                    placeholder="Account Holder Name"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="w-full p-2.5 bg-white border border-[#E5E7EB] rounded-xl text-xs text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#10B981]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-gray-600 font-medium">Account / Wallet ID / Phone / Card No. <span className="text-gray-400 font-normal">(Optional)</span></label>
                  <input 
                    type="text"
                    placeholder="Alipay ID, WeChat ID, or Bank No."
                    value={rmbAccountNumber}
                    onChange={(e) => handleAlphanumericChange(e.target.value, setRmbAccountNumber)}
                    className="w-full p-2.5 bg-white border border-[#E5E7EB] rounded-xl text-xs text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#10B981]"
                  />
                </div>

                <div className="space-y-2 pt-1">
                  <label className="text-[11px] text-gray-600 font-medium">Upload QR Code Image (Optional)</label>
                  <input 
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFileUpload(e, 'qr')}
                    className="w-full p-2 bg-white border border-[#E5E7EB] rounded-xl text-xs text-[#111827] file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-[#0F172A] file:text-white hover:file:bg-[#1E293B]"
                  />
                  {uploadingQr && <p className="text-[11px] text-blue-600 font-semibold">Uploading QR code image...</p>}
                  {qrCodeProof && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-emerald-600 font-bold"> QR Code image uploaded successfully!</p>
                      <input 
                        type="text"
                        readOnly
                        value={qrCodeProof}
                        className="w-full p-2 bg-gray-50 border border-[#E5E7EB] rounded-lg text-[10px] text-gray-500 truncate"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* SUBMIT BUTTON */}
            <button 
              type="submit"
              disabled={submitting}
              className="w-full bg-[#10B981] hover:bg-[#059669] text-white py-3.5 rounded-xl text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-2"
            >
              <span> </span> {submitting ? 'Submitting...' : 'Submit Exchange Request'}
            </button>

          </form>
        </div>
      )}

      {/* VIEW 2: REQUEST HISTORY */}
      {currentView === 'history' && (
        <div className="p-5 bg-white rounded-2xl border border-[#E5E7EB] shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                <span> </span> Your Exchange Request History
              </h3>
              <p className="text-xs text-gray-600 mt-0.5">Track the status of all your submitted currency exchange transactions.</p>
            </div>
            <button 
              type="button" 
              onClick={fetchUserHistory}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all"
            >
              Refresh
            </button>
          </div>

          {loadingHistory ? (
            <p className="text-xs text-gray-500 py-8 text-center">Loading your requests...</p>
          ) : myRequests.length === 0 ? (
            <div className="p-8 text-center space-y-3 bg-[#F8FAFC] rounded-2xl border border-dashed border-gray-300">
              <p className="text-xs text-gray-600">No exchange requests found yet.</p>
              <button 
                type="button"
                onClick={() => setCurrentView('form')}
                className="px-4 py-2 bg-[#10B981] text-white rounded-xl text-xs font-bold shadow-sm"
              >
                Create Your First Request
              </button>
            </div>
          ) : (
            <div className="space-y-3 overflow-x-auto">
              {myRequests.map((req, index) => (
                <div key={index} className="p-4 bg-[#F8FAFC] rounded-xl border border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-gray-900">{req.reference_number}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        req.status === 'completed' || req.status === 'approved' 
                          ? 'bg-emerald-100 text-emerald-700' 
                          : req.status === 'rejected' 
                          ? 'bg-red-100 text-red-700' 
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {req.status || 'pending'}
                      </span>
                    </div>
                    <p className="text-gray-600">
                      RMB: <strong className="text-gray-900">¥{req.rmb_amount}</strong> | Naira: <strong className="text-[#10B981]">₦{req.naira_amount?.toLocaleString()}</strong>
                    </p>
                    <p className="text-[10px] text-gray-400">Submitted: {new Date(req.created_at || Date.now()).toLocaleString()}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    {req.receipts && (
                      <a 
                        href={req.receipts} 
                        target="_blank" 
                        rel="noreferrer"
                        className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-bold"
                      >
                        View Receipt
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: PROFILE */}
      {currentView === 'profile' && (
        <div className="p-5 bg-white rounded-2xl border border-[#E5E7EB] shadow-sm space-y-5">
          <div>
            <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
              <span> </span> User Profile Information
            </h3>
            <p className="text-xs text-gray-600 mt-0.5">Review your account details and identification credentials.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-[#F8FAFC] rounded-xl border border-gray-200 space-y-1">
              <label className="text-[10px] uppercase font-bold text-gray-400">User ID</label>
              <p className="text-xs font-mono font-bold text-gray-900">{userKmid || 'Loading...'}</p>
            </div>

            <div className="p-4 bg-[#F8FAFC] rounded-xl border border-gray-200 space-y-1">
              <label className="text-[10px] uppercase font-bold text-gray-400">Account Status</label>
              <p className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                <span> </span> Active & Verified
              </p>
            </div>

            <div className="p-4 bg-[#F8FAFC] rounded-xl border border-gray-200 space-y-1">
              <label className="text-[10px] uppercase font-bold text-gray-400">Default Exchange Rate</label>
              <p className="text-xs font-bold text-gray-900">1 RMB = ₦{exchangeRate}</p>
            </div>

            <div className="p-4 bg-[#F8FAFC] rounded-xl border border-gray-200 space-y-1">
              <label className="text-[10px] uppercase font-bold text-gray-400">Total Requests Made</label>
              <p className="text-xs font-bold text-gray-900">{myRequests.length} Transactions</p>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 4: CHAT / MESSAGING */}
      {currentView === 'chat' && (
        <div className="p-5 bg-white rounded-2xl border border-[#E5E7EB] shadow-sm space-y-4">
          <div>
            <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
              <span> </span> Live Support & Messaging
            </h3>
            <p className="text-xs text-gray-600 mt-0.5">Chat directly with the Koolswitch support team regarding your transactions.</p>
          </div>

          {/* Chat Messages Box */}
          <div className="h-72 overflow-y-auto p-4 bg-[#F8FAFC] rounded-2xl border border-gray-200 space-y-3 flex flex-col">
            {messages.map((msg, index) => (
              <div 
                key={index} 
                className={`max-w-[80%] p-3 rounded-xl text-xs space-y-1 ${
                  msg.sender === 'user' 
                    ? 'ml-auto bg-[#10B981] text-white rounded-br-none' 
                    : 'mr-auto bg-white border border-gray-200 text-gray-800 rounded-bl-none shadow-xs'
                }`}
              >
                <p className="font-semibold">{msg.text}</p>
                <p className={`text-[9px] text-right ${msg.sender === 'user' ? 'text-emerald-100' : 'text-gray-400'}`}>{msg.time}</p>
              </div>
            ))}
          </div>

          {/* Chat Input Form */}
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <input 
              type="text"
              placeholder="Type your message to support..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              className="flex-1 p-3 bg-white border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#10B981]"
            />
            <button 
              type="submit"
              className="px-5 py-3 bg-[#10B981] hover:bg-[#059669] text-white rounded-xl text-xs font-bold shadow-sm transition-all"
            >
              Send 
            </button>
          </form>
        </div>
      )}
    </div>
  );
}