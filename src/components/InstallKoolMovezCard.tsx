import { useState } from 'react'
import { pwaFallbackCopy, usePwaInstall } from '../hooks/usePwaInstall'

export default function InstallKoolMovezCard() {
  const { visible, fallbackKind, promptInstall } = usePwaInstall()
  const [showHint, setShowHint] = useState(false)

  if (!visible) return null

  return (
    <section className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
      <button
        type="button"
        onClick={() => {
          void promptInstall().then((usedNative) => {
            if (!usedNative) setShowHint(true)
          })
        }}
        className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center px-4 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-bold"
      >
        Install KoolMovez
      </button>
      {showHint ? (
        <p className="text-xs text-slate-600 mt-2">{pwaFallbackCopy(fallbackKind)}</p>
      ) : null}
    </section>
  )
}
