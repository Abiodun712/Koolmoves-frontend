import { usePwaInstall, type PwaFallbackKind } from '../hooks/usePwaInstall'

function fallbackCopy(kind: PwaFallbackKind) {
  switch (kind) {
    case 'ios-safari':
      return 'On iPhone or iPad: tap Share, then Add to Home Screen.'
    case 'ios-other':
      return 'On iPhone or iPad, open KoolMovez in Safari, tap Share, then Add to Home Screen.'
    case 'firefox-android':
      return 'In Firefox: open the menu, then tap Install or Add to Home screen.'
    case 'samsung':
      return 'In Samsung Internet: open the menu, then Add page to → Home screen.'
    case 'desktop-safari':
      return 'In Safari: use File → Add to Dock, or Share → Add to Dock.'
    default:
      return 'Use your browser menu to add KoolMovez to your home screen or apps list.'
  }
}

export default function InstallKoolMovezCard() {
  const { visible, canNativeInstall, fallbackKind, promptInstall } = usePwaInstall()

  if (!visible) return null

  return (
    <section className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-[#0F172A]">Install KoolMovez</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Get quicker access to Exchange, Air Freight and Sea Freight.
        </p>
        {!canNativeInstall ? (
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">{fallbackCopy(fallbackKind)}</p>
        ) : null}
      </div>
      {canNativeInstall ? (
        <button
          type="button"
          onClick={() => void promptInstall()}
          className="shrink-0 w-full sm:w-auto text-center min-h-[44px] inline-flex items-center justify-center px-4 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-bold"
        >
          Install KoolMovez
        </button>
      ) : null}
    </section>
  )
}
