import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

interface ExchangeFormProps {
  onSuccess?: () => void;
}

export const ExchangeForm: React.FC<ExchangeFormProps> = ({ onSuccess }) => {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  
  // Form states
  const [accountType, setAccountType] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [rmbAccountNumber, setRmbAccountNumber] = useState('');
  const [qrCodeProof, setQrCodeProof] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Submission logic goes here
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E5E7EB] max-w-lg mx-auto">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* STEP 4: RMB RECEIVING DETAILS & QR CODE UPLOAD */}
        {step === 4 && (
          <div className="space-y-4 animate-fadeIn">
            <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-[#E5E7EB] space-y-3">
              <h4 className="text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
                RMB Receiving Account / Wallet & QR Code
              </h4>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-gray-600 font-medium">Bank/Wallet Name (Optional)</label>
                  <input 
                    type="text"
                    placeholder="ICBC, Bank of China, Alipay, Wechat pay"
                    value={accountType}
                    onChange={(e) => setAccountType(e.target.value)}
                    className="w-full p-2.5 bg-white border border-[#E5E7EB] rounded-xl text-xs text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#10B981]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-gray-600 font-medium">Recipient Name (Chinese/English)</label>
                  <input 
                    type="text"
                    placeholder="Account Holder Name"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="w-full p-2.5 bg-white border border-[#E5E7EB] rounded-xl text-xs text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#10B981]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-gray-600 font-medium">Account / Wallet ID / Phone / Card No.</label>
                  <input 
                    type="text"
                    placeholder="Alipay ID, WeChat ID, or Bank No."
                    value={rmbAccountNumber}
                    onChange={(e) => setRmbAccountNumber(e.target.value)}
                    className="w-full p-2.5 bg-white border border-[#E5E7EB] rounded-xl text-xs text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#10B981]"
                  />
                </div>

                <div className="space-y-1 pt-1">
                  <label className="text-[11px] text-gray-600 font-medium">QR Code Image URL / Upload Link (Optional)</label>
                  <input 
                    type="text"
                    placeholder="Paste Alipay/WeChat QR Code image link"
                    value={qrCodeProof}
                    onChange={(e) => setQrCodeProof(e.target.value)}
                    className="w-full p-2.5 bg-white border border-[#E5E7EB] rounded-xl text-xs text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#10B981]"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button 
                type="button"
                onClick={() => setStep(3)}
                className="w-1/3 bg-gray-200 hover:bg-gray-300 text-gray-800 py-3 rounded-xl text-xs font-bold transition-all"
              >
                Back
              </button>
              <button 
                type="submit"
                disabled={submitting}
                className="w-2/3 bg-[#10B981] hover:bg-[#059669] text-white py-3 rounded-xl text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-2"
              >
                {submitting ? 'Submitting...' : 'Submit Exchange Request'}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};