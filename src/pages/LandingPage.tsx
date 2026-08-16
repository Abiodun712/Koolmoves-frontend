import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowRight,
  Eye,
  IdCard,
  MapPinned,
  Menu,
  Package,
  Plane,
  Receipt,
  Ship,
  Shuffle,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/dashboard', label: 'Exchange' },
  { href: '/air-freight', label: 'Air Freight' },
  { href: '/sea-freight', label: 'Sea Freight' },
] as const;

function BrandMark({ light = false }: { light?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 min-w-0">
      <div className="w-10 h-10 rounded-xl bg-[#0F172A] flex items-center justify-center shrink-0">
        <span className="text-sm font-extrabold tracking-tight">
          <span className="text-white">K</span>
          <span className="text-emerald-400">Mz</span>
        </span>
      </div>
      <div className="leading-tight">
        <div className={`text-lg font-extrabold tracking-tight ${light ? 'text-white' : 'text-[#0F172A]'}`}>
          KoolMovez
        </div>
        <div className={`text-[10px] font-bold tracking-wide ${light ? 'text-emerald-300' : 'text-emerald-600'}`}>
          China ↔ Nigeria
        </div>
      </div>
    </Link>
  );
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'exchange_rate')
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data?.value) return;
        const parsed = parseFloat(data.value);
        if (Number.isFinite(parsed) && parsed > 0) setExchangeRate(parsed);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <nav className="max-w-6xl mx-auto px-5 sm:px-8 h-16 sm:h-[72px] flex items-center justify-between gap-3">
          <BrandMark />

          <div className="hidden lg:flex items-center gap-7 text-sm font-semibold text-slate-600">
            {navLinks.map((link) => (
              <Link key={link.href} to={link.href} className="hover:text-[#0F172A] transition-colors">
                {link.label}
              </Link>
            ))}
          </div>

          <div className="hidden sm:flex items-center gap-2">
            <Link
              to="/login"
              className="text-sm font-bold text-[#0F172A] px-3.5 py-2 rounded-xl hover:bg-slate-50 transition-colors"
            >
              Login
            </Link>
            <Link
              to="/signup"
              className="text-sm font-bold text-[#0F172A] border border-slate-200 px-3.5 py-2 rounded-xl hover:bg-slate-50 transition-colors"
            >
              Create Account
            </Link>
            <Link
              to="/signup"
              className="text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl transition-colors"
            >
              Get Started
            </Link>
          </div>

          <button
            type="button"
            className="lg:hidden p-2 rounded-xl border border-slate-200 text-[#0F172A]"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </nav>

        {menuOpen ? (
          <div className="lg:hidden border-t border-slate-100 bg-white px-5 pb-5 pt-3 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {link.label}
              </Link>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-3">
              <Link
                to="/login"
                onClick={() => setMenuOpen(false)}
                className="text-center text-sm font-bold border border-slate-200 px-3 py-2.5 rounded-xl"
              >
                Login
              </Link>
              <Link
                to="/signup"
                onClick={() => setMenuOpen(false)}
                className="text-center text-sm font-bold bg-emerald-600 text-white px-3 py-2.5 rounded-xl"
              >
                Get Started
              </Link>
            </div>
          </div>
        ) : null}
      </header>

      <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 via-white to-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(16,185,129,0.08),_transparent_50%)]" />
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12 sm:py-16 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-10 lg:gap-14 items-center">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-emerald-700 mb-4">
                RMB Exchange · Air Freight · Sea Freight
              </p>
              <h1 className="text-[32px] sm:text-5xl lg:text-[56px] font-extrabold tracking-tight text-[#0F172A] leading-[1.08]">
                Naira to RMB. China to Nigeria. One Kool Platform.
              </h1>
              <p className="mt-5 text-base sm:text-lg text-slate-600 max-w-xl leading-relaxed">
                Exchange Naira for RMB, move your goods from China to Nigeria by Air or Sea, on KoolMovez platform — in a Kool movez.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Link
                  to="/signup"
                  className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3.5 rounded-xl transition-colors"
                >
                  Get Started
                  <ArrowRight size={16} />
                </Link>
                <a
                  href="#services"
                  className="inline-flex items-center justify-center bg-white border border-slate-200 hover:bg-slate-50 text-[#0F172A] font-bold px-6 py-3.5 rounded-xl transition-colors"
                >
                  Explore Services
                </a>
              </div>
              <p className="mt-4 text-sm text-slate-500">
                Built for Nigerians doing business between China and Nigeria.
              </p>
            </div>

            <div className="relative">
              <div className="absolute -inset-4 bg-emerald-500/10 blur-3xl rounded-full" />
              <div className="relative space-y-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl shadow-slate-900/5">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                      RMB Exchange
                    </p>
                    <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700">
                      NGN → RMB
                    </span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                      <span className="text-xs font-semibold text-slate-500">You send</span>
                      <span className="text-lg font-extrabold text-[#0F172A]">₦100,000</span>
                    </div>
                    <div className="flex justify-center">
                      <span className="w-8 h-8 rounded-full bg-[#0F172A] text-white flex items-center justify-center">
                        <ArrowDown size={14} />
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
                      <span className="text-xs font-semibold text-emerald-800">You receive</span>
                      <span className="text-lg font-extrabold text-[#0F172A]">RMB</span>
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] text-slate-400">
                    {exchangeRate
                      ? `Published rate: ₦${exchangeRate.toLocaleString()} / RMB`
                      : 'Published rate shown in your account after you sign in.'}
                  </p>
                </div>

                <div className="bg-[#0F172A] text-white border border-slate-800 rounded-2xl p-5 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                      Shipment
                    </p>
                    <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white/10 text-emerald-300">
                      KM-XXXXXX
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-center">
                    <div className="flex-1">
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">China</p>
                      <p className="text-sm font-bold mt-1">Warehouse</p>
                    </div>
                    <div className="flex-1 px-1">
                      <div className="h-px bg-gradient-to-r from-slate-600 via-emerald-400 to-slate-600 relative">
                        <span className="absolute left-1/2 -top-2.5 -translate-x-1/2 text-[9px] font-extrabold text-emerald-300 bg-[#0F172A] px-1">
                          KOOLMOVEZ
                        </span>
                      </div>
                      <div className="flex justify-center gap-3 mt-3 text-slate-300">
                        <Plane size={14} />
                        <Ship size={14} />
                      </div>
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">Nigeria</p>
                      <p className="text-sm font-bold mt-1">Pickup</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-50/80">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {['Transparent Costs', 'China → Nigeria', 'Air & Sea Freight', 'Secure Payment Process'].map(
            (item) => (
              <p
                key={item}
                className="text-center text-xs sm:text-sm font-bold text-slate-700 py-2"
              >
                {item}
              </p>
            )
          )}
        </div>
      </section>

      <section id="services" className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20 scroll-mt-24">
        <div className="max-w-2xl mb-10">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight">
            Everything You Need in One Platform
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
            Whether you need RMB for your China transactions or need to move your goods to Nigeria,
            KoolMovez brings the process together.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          <article className="group bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-emerald-200 transition-all">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
              <Shuffle size={20} />
            </div>
            <h3 className="text-lg font-extrabold text-[#0F172A]">RMB Exchange</h3>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Exchange Naira for RMB through a simple, transparent process.
            </p>
            <div className="mt-5 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-center text-xs font-bold text-slate-700">
              ₦ NGN
              <ArrowDown size={14} className="mx-auto my-1 text-emerald-600" />
              RMB
            </div>
            <Link
              to="/dashboard"
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 group-hover:text-emerald-800"
            >
              Exchange RMB <ArrowRight size={14} />
            </Link>
          </article>

          <article className="group bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-emerald-200 transition-all">
            <div className="w-11 h-11 rounded-xl bg-slate-100 text-[#0F172A] flex items-center justify-center mb-4">
              <Plane size={20} />
            </div>
            <h3 className="text-lg font-extrabold text-[#0F172A]">Air Freight</h3>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Move goods from China to Nigeria when speed matters.
            </p>
            <div className="mt-5 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-center text-xs font-bold text-slate-700">
              China → → Nigeria
            </div>
            <Link
              to="/air-freight"
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 group-hover:text-emerald-800"
            >
              Ship by Air <ArrowRight size={14} />
            </Link>
          </article>

          <article className="group bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-emerald-200 transition-all">
            <div className="w-11 h-11 rounded-xl bg-slate-100 text-[#0F172A] flex items-center justify-center mb-4">
              <Ship size={20} />
            </div>
            <h3 className="text-lg font-extrabold text-[#0F172A]">Sea Freight</h3>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Move larger shipments from China to Nigeria with a cost-effective freight option.
            </p>
            <div className="mt-5 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-center text-xs font-bold text-slate-700">
              China → → Nigeria
            </div>
            <Link
              to="/sea-freight"
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 group-hover:text-emerald-800"
            >
              Ship by Sea <ArrowRight size={14} />
            </Link>
          </article>
        </div>
      </section>

      <section id="how-it-works" className="bg-slate-50 border-y border-slate-200 scroll-mt-24">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight">
            One Platform. One Simple Process.
          </h2>
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              {
                step: '01',
                title: 'Create Your Account',
                desc: 'Create your KoolMovez account and receive your unique KM ID.',
              },
              {
                step: '02',
                title: 'Send Your Goods',
                desc: 'Send your goods to the appropriate KoolMovez warehouse in China.',
              },
              {
                step: '03',
                title: 'Choose How to Ship',
                desc: 'Select Air Freight or Sea Freight depending on your needs.',
              },
              {
                step: '04',
                title: 'Track Your Shipment',
                desc: 'Follow your shipment through the KoolMovez platform.',
              },
              {
                step: '05',
                title: 'Receive in Nigeria',
                desc: 'Collect your goods from the designated Nigeria location.',
              },
            ].map((item, index) => (
              <div key={item.step} className="relative bg-white border border-slate-200 rounded-2xl p-5">
                <p className="text-[11px] font-extrabold text-emerald-600">{item.step}</p>
                <h3 className="mt-2 text-sm font-extrabold text-[#0F172A]">{item.title}</h3>
                <p className="mt-2 text-xs text-slate-600 leading-relaxed">{item.desc}</p>
                {index < 4 ? (
                  <div className="hidden lg:block absolute top-6 -right-3 text-slate-300">
                    <ArrowRight size={16} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="why" className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20 scroll-mt-24">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight">
          Built Around How You Trade
        </h2>
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              icon: MapPinned,
              title: 'China-to-Nigeria Focus',
              desc: 'Built specifically around the needs of Nigerians doing business with China.',
            },
            {
              icon: Receipt,
              title: 'Transparent Costs',
              desc: 'See the applicable freight, packing and clearing/landing costs.',
            },
            {
              icon: IdCard,
              title: 'One KM ID',
              desc: 'Use your unique KM ID to identify and manage your goods.',
            },
            {
              icon: Plane,
              title: 'Air or Sea',
              desc: 'Choose the shipping option that fits your shipment.',
            },
            {
              icon: Eye,
              title: 'Shipment Visibility',
              desc: 'Keep track of your goods and shipment status through your account.',
            },
            {
              icon: Package,
              title: 'Simple Digital Process',
              desc: 'Manage your exchange and logistics journey from one platform.',
            },
          ].map((item) => (
            <div key={item.title} className="border border-slate-200 rounded-2xl p-5 bg-white">
              <item.icon size={20} className="text-emerald-600" />
              <h3 className="mt-3 text-sm font-extrabold text-[#0F172A]">{item.title}</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-[#0F172A] text-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">From Payment to Delivery</h2>
          <p className="mt-3 text-sm text-slate-300 max-w-2xl">
            Exchange and logistics live side by side. One does not automatically complete the other —
            you choose the service you need.
          </p>
          <div className="mt-10 grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-300">Money</p>
              <h3 className="mt-2 text-lg font-extrabold">RMB Exchange</h3>
              <div className="mt-6 space-y-2 text-sm font-semibold text-slate-200">
                <p>NGN</p>
                <ArrowDown size={16} className="text-emerald-400" />
                <p>RMB</p>
                <ArrowDown size={16} className="text-emerald-400" />
                <p>China Purchase</p>
              </div>
            </div>
            <div className="flex items-center justify-center">
              <div className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-5 py-3 text-xs font-extrabold tracking-[0.2em] text-emerald-300">
                KOOLMOVEZ
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-300">Goods</p>
              <h3 className="mt-2 text-lg font-extrabold">Logistics</h3>
              <div className="mt-6 space-y-2 text-sm font-semibold text-slate-200">
                <p>China Supplier</p>
                <ArrowDown size={16} className="text-emerald-400" />
                <p>KoolMovez Warehouse</p>
                <ArrowDown size={16} className="text-emerald-400" />
                <p>Air / Sea</p>
                <ArrowDown size={16} className="text-emerald-400" />
                <p>Nigeria</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight">
              Know Your Shipment Cost
            </h2>
            <p className="mt-4 text-sm sm:text-base text-slate-600 leading-relaxed max-w-md">
              Your shipment costs are calculated from the applicable freight rate, packing fee and
              clearing/landing cost.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-extrabold text-[#0F172A]">Sample shipment cost</p>
              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
                Example only
              </span>
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Freight</dt>
                <dd className="font-bold text-[#0F172A]">₦20,000</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Packing</dt>
                <dd className="font-bold text-[#0F172A]">₦5,000</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Clearing</dt>
                <dd className="font-bold text-[#0F172A]">₦3,000</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-3">
                <dt className="font-extrabold text-[#0F172A]">Total</dt>
                <dd className="font-extrabold text-[#0F172A]">₦28,000</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20 grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight">
              Your Goods Have an Identity.
            </h2>
            <p className="mt-4 text-sm sm:text-base text-slate-600 leading-relaxed max-w-md">
              Your unique KM ID helps KoolMovez identify your goods from the moment they arrive at
              our China warehouse.
            </p>
          </div>
          <div className="bg-gradient-to-br from-[#0F172A] to-slate-800 text-white rounded-2xl p-6 sm:p-8 shadow-xl">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-emerald-300">
              Your KoolMovez ID
            </p>
            <p className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight font-mono">KM-XXXXXX</p>
            <p className="mt-3 text-xs text-slate-300">Issued when you create your account.</p>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight">
          Choose What Works for You
        </h2>
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-5">
          <article className="border border-slate-200 rounded-2xl p-6 bg-white">
            <div className="flex items-center gap-3">
              <Plane className="text-emerald-600" size={22} />
              <h3 className="text-lg font-extrabold text-[#0F172A]">Air Freight</h3>
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-700">Speed when you need it.</p>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              <li>Faster shipping option</li>
              <li>Suitable for goods where time matters</li>
              <li>Weight-based freight</li>
            </ul>
            <Link
              to="/air-freight"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700"
            >
              Explore Air Freight <ArrowRight size={14} />
            </Link>
          </article>
          <article className="border border-slate-200 rounded-2xl p-6 bg-white">
            <div className="flex items-center gap-3">
              <Ship className="text-emerald-600" size={22} />
              <h3 className="text-lg font-extrabold text-[#0F172A]">Sea Freight</h3>
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-700">Value for larger shipments.</p>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              <li>Cost-effective freight option</li>
              <li>Suitable for larger shipments</li>
              <li>CBM-based freight</li>
            </ul>
            <Link
              to="/sea-freight"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700"
            >
              Explore Sea Freight <ArrowRight size={14} />
            </Link>
          </article>
        </div>
      </section>

      <section className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight">
            Trade With More Clarity.
          </h2>
          <p className="mt-4 text-sm sm:text-base text-slate-600 max-w-2xl leading-relaxed">
            KoolMovez brings your exchange and logistics activities into one simple digital
            experience, helping you understand what you&apos;re paying for and where your shipment is
            in the process.
          </p>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {['Clear Costs', 'Digital Records', 'Shipment Visibility'].map((item) => (
              <div
                key={item}
                className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-[#0F172A]"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <div className="bg-[#0F172A] rounded-3xl px-6 py-12 sm:px-12 sm:py-16 text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Ready to Move Your Money and Goods?
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-300">
            Create your KoolMovez account and start your China-to-Nigeria journey.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center max-w-sm sm:max-w-none mx-auto">
            <Link
              to="/signup"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-7 py-3.5 rounded-xl transition-colors"
            >
              Create Account
            </Link>
            <Link
              to="/login"
              className="border border-slate-600 hover:bg-slate-800 text-white font-bold px-7 py-3.5 rounded-xl transition-colors"
            >
              Login
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-1">
            <BrandMark />
            <p className="mt-4 text-xs text-slate-500 leading-relaxed max-w-xs">
              Connecting China and Nigeria through simple digital financial and logistics services.
            </p>
          </div>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Services</p>
            <div className="mt-3 space-y-2 text-sm font-semibold">
              <Link to="/dashboard" className="block text-slate-700 hover:text-[#0F172A]">
                RMB Exchange
              </Link>
              <Link to="/air-freight" className="block text-slate-700 hover:text-[#0F172A]">
                Air Freight
              </Link>
              <Link to="/sea-freight" className="block text-slate-700 hover:text-[#0F172A]">
                Sea Freight
              </Link>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Account</p>
            <div className="mt-3 space-y-2 text-sm font-semibold">
              <Link to="/login" className="block text-slate-700 hover:text-[#0F172A]">
                Login
              </Link>
              <Link to="/signup" className="block text-slate-700 hover:text-[#0F172A]">
                Create Account
              </Link>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Support</p>
            <a
              href="mailto:support@koolmovez.com"
              className="mt-3 block text-sm font-semibold text-slate-700 hover:text-[#0F172A]"
            >
              support@koolmovez.com
            </a>
          </div>
        </div>
        <div className="border-t border-slate-100">
          <p className="max-w-6xl mx-auto px-5 sm:px-8 py-6 text-xs text-slate-500">
            KoolMovez. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
