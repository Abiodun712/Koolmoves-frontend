import { useCallback, useEffect, useState } from 'react'

export type PwaFallbackKind =
  | 'ios-safari'
  | 'ios-other'
  | 'firefox-android'
  | 'samsung'
  | 'desktop-safari'
  | 'generic'

function detectInstalled() {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  if (window.matchMedia('(display-mode: window-controls-overlay)').matches) return true
  if (document.referrer.startsWith('android-app://')) return true
  return false
}

function detectFallbackKind(): PwaFallbackKind {
  const ua = window.navigator.userAgent
  const iPadOsDesktopUa =
    window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1
  const isIos = /iPhone|iPad|iPod/i.test(ua) || iPadOsDesktopUa
  const isAndroid = /Android/i.test(ua)
  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|OPiOS|Android/i.test(ua)
  const isFirefox = /Firefox|FxiOS/i.test(ua)
  const isSamsung = /SamsungBrowser/i.test(ua)

  if (isIos && isSafari) return 'ios-safari'
  if (isIos) return 'ios-other'
  if (isAndroid && isFirefox) return 'firefox-android'
  if (isAndroid && isSamsung) return 'samsung'
  if (isSafari && !isAndroid && !isIos) return 'desktop-safari'
  return 'generic'
}

export function usePwaInstall() {
  const [installed, setInstalled] = useState(detectInstalled)
  const [nativeEvent, setNativeEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [fallbackKind, setFallbackKind] = useState<PwaFallbackKind>('generic')

  useEffect(() => {
    setInstalled(detectInstalled())
    setFallbackKind(detectFallbackKind())

    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      setNativeEvent(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setNativeEvent(null)
      setInstalled(true)
    }
    const media = window.matchMedia('(display-mode: standalone)')
    const onDisplayMode = () => setInstalled(detectInstalled())

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    media.addEventListener('change', onDisplayMode)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      media.removeEventListener('change', onDisplayMode)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!nativeEvent) return
    await nativeEvent.prompt()
    const { outcome } = await nativeEvent.userChoice
    setNativeEvent(null)
    if (outcome === 'accepted') setInstalled(true)
  }, [nativeEvent])

  return {
    visible: !installed,
    canNativeInstall: Boolean(nativeEvent),
    fallbackKind,
    promptInstall,
  }
}
