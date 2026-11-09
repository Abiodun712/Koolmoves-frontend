import { useEffect, useState } from 'react';
import type { ClipboardEvent, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown } from 'lucide-react';
import {
  INDICATIVE_RATE_NOTE,
  LOADING_RATE_LABEL,
  START_EXCHANGE_PATH,
  UNAVAILABLE_RATE_LABEL,
  formatPlatformRateLine,
  type PublishedRate,
} from '../lib/publishedExchangeRate';
import { convertDraft, isAmountDraft, nextAmountDraft, sanitizePastedAmount } from '../lib/rmbAmount';

type Side = 'ngn' | 'rmb';

type RmbExchangeCalculatorProps = {
  loadRate?: () => Promise<PublishedRate>;
  /** Re-read interval while the tab is visible. 0 disables the timer. */
  refreshMs?: number;
};

function usableRate(phase: 'loading' | 'ready' | 'unavailable', rate: number | null): number | null {
  if (phase !== 'ready' || rate == null) return null;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return rate;
}

async function resolveLoader(
  loadRate: (() => Promise<PublishedRate>) | undefined,
): Promise<() => Promise<PublishedRate>> {
  if (loadRate) return loadRate;
  const mod = await import('../lib/publishedExchangeRateSource');
  return mod.loadPublishedPlatformRate;
}

export default function RmbExchangeCalculator({
  loadRate,
  refreshMs = 60_000,
}: RmbExchangeCalculatorProps) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [rate, setRate] = useState<number | null>(null);
  const [source, setSource] = useState<Side | null>(null);
  const [ngnText, setNgnText] = useState('');
  const [rmbText, setRmbText] = useState('');

  useEffect(() => {
    let cancelled = false;
    let seq = 0;

    const run = async (kind: 'initial' | 'refresh') => {
      if (kind === 'refresh' && document.visibilityState === 'hidden') return;
      const id = ++seq;
      if (kind === 'initial') {
        setPhase('loading');
        setRate(null);
      }
      try {
        const loader = await resolveLoader(loadRate);
        if (cancelled || id !== seq) return;
        const result = await loader();
        if (cancelled || id !== seq) return;
        if (result.status === 'ready' && Number.isFinite(result.rate) && result.rate > 0) {
          setPhase('ready');
          setRate(result.rate);
          return;
        }
        setPhase('unavailable');
        setRate(null);
      } catch {
        if (cancelled || id !== seq) return;
        setPhase('unavailable');
        setRate(null);
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void run('refresh');
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer =
      refreshMs > 0
        ? window.setInterval(() => {
            if (document.visibilityState === 'visible') void run('refresh');
          }, refreshMs)
        : 0;
    void run('initial');

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) window.clearInterval(timer);
    };
  }, [loadRate, refreshMs]);

  const activeRate = usableRate(phase, rate);
  const ngnValue =
    source === 'rmb' ? (activeRate == null ? '' : convertDraft(rmbText, activeRate, 'rmb-to-ngn')) : ngnText;
  const rmbValue =
    source === 'ngn' ? (activeRate == null ? '' : convertDraft(ngnText, activeRate, 'ngn-to-rmb')) : rmbText;
  const rateLine =
    activeRate == null
      ? phase === 'loading'
        ? LOADING_RATE_LABEL
        : UNAVAILABLE_RATE_LABEL
      : (formatPlatformRateLine(activeRate) ?? UNAVAILABLE_RATE_LABEL);

  const commit = (side: Side, incoming: string) => {
    if (!isAmountDraft(incoming)) return;
    if (incoming === '') {
      setSource(null);
      setNgnText('');
      setRmbText('');
      return;
    }
    setSource(side);
    if (side === 'ngn') setNgnText(incoming);
    else setRmbText(incoming);
  };

  const onChange = (side: Side, event: FormEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const current = side === 'ngn' ? ngnValue : rmbValue;
    const accepted = nextAmountDraft(current, input.value);
    if (accepted !== input.value) {
      input.value = current;
      return;
    }
    commit(side, accepted);
  };

  const onBeforeInput = (event: FormEvent<HTMLInputElement>) => {
    const native = event.nativeEvent;
    if (!(native instanceof InputEvent)) return;
    if (native.inputType.startsWith('delete')) return;
    if (native.inputType === 'insertFromPaste' || native.inputType === 'insertFromDrop') return;
    const data = native.data ?? '';
    if (!data) return;
    const el = event.currentTarget;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + data + el.value.slice(end);
    if (!isAmountDraft(next)) event.preventDefault();
  };

  const onPaste = (side: Side, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = sanitizePastedAmount(event.clipboardData.getData('text'));
    if (!pasted) return;
    const el = event.currentTarget;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + pasted + el.value.slice(end);
    if (!isAmountDraft(next)) return;
    commit(side, next);
  };

  return (
    <div
      role="region"
      aria-label="RMB Exchange"
      aria-busy={phase === 'loading'}
      data-testid="rmb-exchange"
      className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl shadow-slate-900/5"
    >
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">RMB Exchange</p>
        <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700">NGN ↔ RMB</span>
      </div>

      <p
        id="rmb-exchange-rate-status"
        role="status"
        aria-live="polite"
        data-testid="published-rate"
        className={`text-sm font-extrabold ${activeRate == null ? 'text-slate-500' : 'text-[#0F172A]'}`}
      >
        {rateLine}
      </p>

      <div className="space-y-3 mt-4">
        <label htmlFor="landing-ngn-amount" className="block rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 focus-within:ring-2 focus-within:ring-emerald-500">
          <span className="text-xs font-semibold text-slate-500">Naira (NGN)</span>
          <span className="mt-1 flex items-center gap-1">
            <span className="text-lg font-extrabold text-[#0F172A]" aria-hidden="true">
              ₦
            </span>
            <input
              id="landing-ngn-amount"
              data-testid="ngn-amount"
              inputMode="decimal"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Naira amount"
              aria-describedby="rmb-exchange-rate-status rmb-exchange-note"
              value={ngnValue}
              onBeforeInput={onBeforeInput}
              onPaste={(event) => onPaste('ngn', event)}
              onChange={(event) => onChange('ngn', event)}
              className="w-full min-w-0 bg-transparent text-lg font-extrabold text-[#0F172A] outline-none"
            />
          </span>
        </label>

        <div className="flex justify-center">
          <span className="w-8 h-8 rounded-full bg-[#0F172A] text-white flex items-center justify-center" aria-hidden="true">
            <ArrowDown size={14} />
          </span>
        </div>

        <label htmlFor="landing-rmb-amount" className="block rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3 focus-within:ring-2 focus-within:ring-emerald-500">
          <span className="text-xs font-semibold text-emerald-800">RMB</span>
          <input
            id="landing-rmb-amount"
            data-testid="rmb-amount"
            inputMode="decimal"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="RMB amount"
            aria-describedby="rmb-exchange-rate-status rmb-exchange-note"
            value={rmbValue}
            onBeforeInput={onBeforeInput}
            onPaste={(event) => onPaste('rmb', event)}
            onChange={(event) => onChange('rmb', event)}
            className="mt-1 w-full min-w-0 bg-transparent text-lg font-extrabold text-[#0F172A] outline-none"
          />
        </label>
      </div>

      <p id="rmb-exchange-note" data-testid="rate-note" className="mt-3 text-[11px] text-slate-500 leading-relaxed">
        {INDICATIVE_RATE_NOTE}
      </p>

      <Link
        to={START_EXCHANGE_PATH}
        data-testid="start-exchange"
        className="mt-4 flex w-full items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
      >
        Start Exchange
      </Link>
    </div>
  );
}
