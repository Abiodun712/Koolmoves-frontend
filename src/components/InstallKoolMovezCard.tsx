import { useState } from 'react'
import { pwaFallbackCopy, usePwaInstall } from '../hooks/usePwaInstall'

export default function InstallKoolMovezCard() {
  const { visible, fallbackKind, promptInstall } = usePwaInstall()
  const [showHint, setShowHint] = useState(false)

  if (!visible) return null

  return (
    <section className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-[#0F172A]">Install KoolMovez</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Get quicker access to Exchange, Air Freight and Sea Freight.
        </p>
        {showHint ? (
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">{pwaFallbackCopy(fallbackKind)}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => {
          void promptInstall().then((usedNative) => {
            if (!usedNative) setShowHint(true)
          })
        }}
        className="shrink-0 w-full sm:w-auto text-center min-h-[44px] inline-flex items-center justify-center px-4 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-bold"
      >
        Install KoolMovez
      </button>
    </section>
  )
}
