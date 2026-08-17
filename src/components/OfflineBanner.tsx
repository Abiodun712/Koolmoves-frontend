import { useEffect, useState } from 'react'

/** Non-blocking notice only. Does not queue or fake-submit forms. */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  )

  useEffect(() => {
    const goOnline = () => setOffline(false)
    const goOffline = () => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="status"
      className="bg-amber-500 text-[#0F172A] text-center text-xs font-bold py-2 px-3"
    >
      You are offline. Exchange, freight, and payment updates need a connection.
    </div>
  )
}
