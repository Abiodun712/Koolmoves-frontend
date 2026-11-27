import { useState } from 'react';
import type { NairaAccountPhase, NairaAccountView } from '../lib/exchangeNairaAccount';

export function NairaAccountRequest({
  phase,
  account,
  onRequest,
}: {
  phase: NairaAccountPhase;
  account: NairaAccountView | null;
  onRequest: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const revealed = phase === 'ready' && account;

  const copyNumber = () => {
    if (!account) return;
    void navigator.clipboard.writeText(account.accountNumber).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setCopied(false);
    });
  };

  return (
    <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-[#E5E7EB] space-y-3" data-testid="naira-account-request">
      <h4 className="text-xs font-bold text-[#0F172A]">Naira payment account</h4>
      {revealed ? (
        <div className="space-y-2" data-testid="naira-account-details">
          <p className="text-[11px] text-gray-600">
            Pay this exchange into this account only. Refreshing the page keeps the same account.
          </p>
          <div className="p-3 bg-white rounded-xl border border-[#E5E7EB] space-y-2 shadow-sm">
            <div className="flex justify-between items-center gap-2">
              <span className="text-[10px] bg-[#0F172A] text-white px-2 py-0.5 rounded font-bold">Naira account</span>
              <button
                type="button"
                onClick={copyNumber}
                className="text-[10px] bg-gray-100 hover:bg-[#10B981] hover:text-white text-gray-700 font-bold px-2.5 py-1 rounded-lg"
              >
                {copied ? 'Copied!' : 'Copy Number'}
              </button>
            </div>
            <p className="text-xs font-extrabold text-[#111827]">{account.bankName}</p>
            <p className="text-xs font-mono font-bold text-[#10B981] tracking-wider" data-testid="naira-account-number">
              {account.accountNumber}
            </p>
            <p className="text-[11px] text-gray-500">{account.accountName}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-gray-600">
            Account details stay hidden until you request them for this exchange.
          </p>
          {phase === 'empty' && (
            <p className="text-[11px] font-semibold text-amber-800" data-testid="naira-account-empty">
              No company Naira account is available right now.
            </p>
          )}
          {phase === 'unavailable' && (
            <p className="text-[11px] font-semibold text-amber-800" data-testid="naira-account-unavailable">
              Naira account details could not be loaded. They stay hidden.
            </p>
          )}
          <button
            type="button"
            onClick={onRequest}
            disabled={phase === 'loading'}
            data-testid="request-naira-account"
            className="bg-[#0F172A] hover:bg-[#1E293B] disabled:opacity-60 text-white px-3 py-2 rounded-xl text-xs font-bold"
          >
            {phase === 'loading' ? 'Requesting account...' : 'Request Naira account'}
          </button>
        </div>
      )}
    </div>
  );
}
