import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

export default function LandingPage() {
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [nairaInput, setNairaInput] = useState('100000');

  useEffect(() => {
    fetchRate();
  }, []);

  const fetchRate = async () => {
    const { data } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'exchange_rate')
      .single();

    if (data?.value) {
      setExchangeRate(parseFloat(data.value));
    }
  };

  // exchangeRate is stored as "₦ per RMB" (matches how the rest of the app uses it)
  const rmbValue = exchangeRate && exchangeRate > 0
    ? (parseFloat(nairaInput || '0') / exchangeRate).toLocaleString(undefined, { maximumFractionDigits: 2 })
    : null;

  return (
    <div className="min-h-screen bg-white text-slate-900">

      {/* NAVIGATION */}
      <nav className="max-w-5xl mx-auto px-5 sm:px-8 h-20 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-[#0F172A] flex items-center justify-center">
            <span className="text-sm font-extrabold tracking-tight">
              <span className="text-white">K</span><span className="text-emerald-400">Mz</span>
            </span>
          </div>
          <div className="leading-tight">
            <div className="text-lg font-extrabold text-[#0F172A]">KoolMovez</div>
            <div className="text-[10px] font-bold text-emerald-600 tracking-wide">Fast. Secure. Reliable.</div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            to="/login"
            className="text-xs sm:text-sm font-bold text-[#0F172A] border border-slate-200 px-3.5 sm:px-5 py-2.5 rounded-xl hover:bg-slate-50 transition-colors"
          >
            Login
          </Link>
          <Link
            to="/signup"
            className="text-xs sm:text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 sm:px-5 py-2.5 rounded-xl transition-colors"
          >
            Sign Up
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <section className="bg-gradient-to-b from-emerald-50/60 to-white">
        <div className="max-w-5xl mx-auto px-5 sm:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 items-center py-8 sm:py-12 lg:py-16">

            <div>
              <h1 className="text-3xl sm:text-4xl lg:text-[46px] font-extrabold tracking-tight text-[#0F172A] leading-tight">
                Exchange Naira to RMB Easily
              </h1>
              <p className="text-sm sm:text-base text-slate-500 max-w-md leading-relaxed mt-4">
                A simple, secure way to trade Naira for RMB — submit, pay, and receive.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mt-7">
                <Link
                  to="/signup"
                  className="text-center bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3.5 rounded-xl transition-colors active:scale-[0.98]"
                >
                  Create Account
                </Link>
                <Link
                  to="/login"
                  className="text-center bg-white border border-slate-200 hover:bg-slate-50 text-[#0F172A] font-bold px-6 py-3.5 rounded-xl transition-colors active:scale-[0.98]"
                >
                  Login
                </Link>
              </div>
            </div>

            {/* EXCHANGE PREVIEW CARD */}
            <div>
              <div className="bg-white rounded-3xl p-6 shadow-xl shadow-slate-900/10 border border-slate-100">
                <div className="pb-4 mb-4 border-b border-slate-100">
                  <label className="text-xs text-slate-500 font-semibold">You Pay</label>
                  <div className="flex items-center justify-between gap-3 mt-1.5">
                    <div className="flex items-center gap-1 text-2xl font-extrabold text-[#0F172A]">
                      <span>₦</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={nairaInput}
                        onChange={(e) => setNairaInput(e.target.value.replace(/[^0-9]/g, ''))}
                        className="w-32 sm:w-36 focus:outline-none"
                      />
                    </div>
                    <span className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-600 shrink-0">NGN</span>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-500 font-semibold">You Receive</label>
                  <div className="flex items-center justify-between gap-3 mt-1.5">
                    <span className="text-2xl font-extrabold text-[#0F172A] truncate">
                      ¥{rmbValue ?? '—'}
                    </span>
                    <span className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-600 shrink-0">RMB</span>
                  </div>
                </div>

                <div className="mt-5 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-3 flex items-center gap-2">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                    <rect x="5" y="11" width="14" height="9" rx="2" stroke="#15803D" strokeWidth="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="#15803D" strokeWidth="2" />
                  </svg>
                  <span className="text-xs font-bold text-emerald-700">Secure &amp; Reliable Exchange</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 text-center mt-3">
                {exchangeRate ? `Rate: ₦${exchangeRate.toLocaleString()} / RMB` : 'Fetching live rate…'}
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="max-w-5xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
        <div className="text-center max-w-md mx-auto mb-10 sm:mb-12">
          <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-600 mb-2">How It Works</p>
          <h2 className="text-2xl sm:text-[28px] font-extrabold text-[#0F172A]">Simple Process. Fast Results.</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          {[
            {
              step: '1',
              title: 'Create Account',
              desc: 'Sign up free and verify your account in seconds.',
              icon: (
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                  <circle cx="12" cy="8" r="3.5" stroke="#16A34A" strokeWidth="2" />
                  <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ),
            },
            {
              step: '2',
              title: 'Enter RMB Amount',
              desc: 'Tell us how much RMB you need at the live rate.',
              icon: (
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                  <rect x="5" y="3" width="14" height="18" rx="2" stroke="#16A34A" strokeWidth="2" />
                  <path d="M8 8h8M8 12h2M12 12h2M8 16h2M12 16h2" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ),
            },
            {
              step: '3',
              title: 'Pay Naira & Upload Receipt',
              desc: 'Transfer the Naira amount and upload your proof of payment.',
              icon: (
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                  <rect x="3" y="6" width="18" height="13" rx="2" stroke="#16A34A" strokeWidth="2" />
                  <path d="M3 10h18" stroke="#16A34A" strokeWidth="2" />
                </svg>
              ),
            },
            {
              step: '4',
              title: 'Receive RMB',
              desc: 'We verify your payment and send your RMB securely.',
              icon: (
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                  <path d="M4 12l16-8-6 16-3-6-7-2z" stroke="#16A34A" strokeWidth="2" strokeLinejoin="round" />
                </svg>
              ),
            },
          ].map((s) => (
            <div key={s.step} className="bg-white border border-slate-100 rounded-2xl p-5 sm:p-6 text-center shadow-sm">
              <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                {s.icon}
              </div>
              <div className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-extrabold mb-2.5">
                {s.step}
              </div>
              <p className="text-sm font-extrabold text-[#0F172A] mb-1.5">{s.title}</p>
              <p className="text-xs text-slate-500 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* WHY KOOLMOVEZ */}
      <section className="bg-slate-50/70">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
          <div className="text-center max-w-md mx-auto mb-10 sm:mb-12">
            <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-600 mb-2">Why KoolMovez</p>
            <h2 className="text-2xl sm:text-[28px] font-extrabold text-[#0F172A]">Built to Move Your Money Safely</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
            {[
              {
                title: 'Secure',
                desc: 'Every exchange is escrow-protected from submission to completion.',
                icon: (
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" stroke="#16A34A" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M9 12l2 2 4-4" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ),
              },
              {
                title: 'Transparent Rates',
                desc: 'No hidden fees — the rate you see is exactly what you get.',
                icon: (
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                    <path d="M5 19V10M12 19V5M19 19v-6" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                ),
              },
              {
                title: 'Fast Processing',
                desc: 'Track your request from pending to completed, in real time.',
                icon: (
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                    <circle cx="12" cy="12" r="8" stroke="#16A34A" strokeWidth="2" />
                    <path d="M12 8v4l3 2" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ),
              },
            ].map((f) => (
              <div key={f.title} className="bg-white border border-slate-100 rounded-2xl p-6">
                <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center mb-4">
                  {f.icon}
                </div>
                <p className="text-sm font-extrabold text-[#0F172A] mb-1.5">{f.title}</p>
                <p className="text-xs text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="max-w-5xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
        <div className="bg-[#0F172A] rounded-3xl p-8 sm:p-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-6">Ready to exchange RMB?</h2>
          <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-xs sm:max-w-none mx-auto">
            <Link
              to="/signup"
              className="text-center bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-7 py-3.5 rounded-xl transition-colors active:scale-[0.98]"
            >
              Create Account
            </Link>
            <Link
              to="/login"
              className="text-center bg-transparent border border-slate-700 hover:bg-slate-800 text-white font-bold px-7 py-3.5 rounded-xl transition-colors active:scale-[0.98]"
            >
              Login
            </Link>
          </div>
        </div>
      </section>

      {/* MINIMAL FOOTER */}
      <footer className="border-t border-slate-100">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-slate-500">
          <span>&copy; 2026 KoolMovez</span>
          <a href="mailto:support@koolmovez.com" className="hover:text-slate-700 transition-colors">
            support@koolmovez.com
          </a>
        </div>
      </footer>

    </div>
  );
}