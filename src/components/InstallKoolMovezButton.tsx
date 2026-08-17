import { useState } from 'react'
import { pwaFallbackCopy, usePwaInstall } from '../hooks/usePwaInstall'

type InstallButtonVariant = 'hero' | 'header' | 'menu' | 'footer'

const variantClass: Record<InstallButtonVariant, string> = {
  hero: 'w-full sm:w-auto inline-flex items-center justify-center bg-white border border-slate-200 hover:bg-slate-50 text-[#0F172A] font-bold px-6 py-3.5 rounded-xl transition-colors',
  header:
    'text-sm font-bold text-[#0F172A] border border-slate-200 px-3.5 py-2 rounded-xl hover:bg-slate-50 transition-colors',
  menu: 'w-full text-center text-sm font-bold border border-slate-200 px-3 py-2.5 rounded-xl text-[#0F172A]',
  footer:
    'w-full sm:w-auto border border-slate-500 hover:bg-slate-800 text-white font-bold px-7 py-3.5 rounded-xl transition-colors',
}

export function InstallKoolMovezButton({
  variant,
}: {
  variant: InstallButtonVariant
}) {
  const { visible, fallbackKind, promptInstall } = usePwaInstall()
  const [showHint, setShowHint] = useState(false)

  if (!visible) return null

  return (
    <div className={variant === 'hero' || variant === 'footer' ? 'w-full sm:w-auto min-w-0' : 'min-w-0'}>
      <button
        type="button"
        onClick={() => {
          void promptInstall().then((usedNative) => {
            if (!usedNative) setShowHint(true)
          })
        }}
        className={variantClass[variant]}
      >
        Install KoolMovez
      </button>
      {showHint ? (
        <p
          className={`mt-2 text-xs leading-relaxed ${
            variant === 'footer' ? 'text-slate-300' : 'text-slate-600'
          }`}
        >
          {pwaFallbackCopy(fallbackKind)}
        </p>
      ) : null}
    </div>
  )
}
