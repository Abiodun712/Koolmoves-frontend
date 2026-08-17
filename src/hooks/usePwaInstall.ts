import { useCallback, useEffect, useState } from 'react'

export type PwaFallbackKind =
  | 'ios-safari'
  | 'ios-other'
  | 'firefox-android'
  | 'samsung'
  | 'desktop-safari'
  | 'generic'

export function pwaFallbackCopy(kind: PwaFallbackKind) {
  switch (kind) {
    case 'ios-safari':
    case 'ios-other':
      return 'Tap Share, then Add to Home Screen.'
    case 'firefox-android':
    case 'samsung':
      return 'Open the menu, then Add to Home Screen.'
    case 'desktop-safari':
      return 'Use Share, then Add to Dock.'
    default:
      return 'Use the browser menu to Add to Home Screen.'
  }
}

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

type Listener = () => void
const listeners = new Set<Listener>()
let capturedPrompt: BeforeInstallPromptEvent | null = null
let globalInstalled = false
let started = false

function emit() {
  listeners.forEach((listener) => listener())
}

export function capturePwaInstallPrompt() {
  if (started || typeof window === 'undefined') return
  started = true
  globalInstalled = detectInstalled()

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    capturedPrompt = event as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    capturedPrompt = null
    globalInstalled = true
    emit()
  })
  window.matchMedia('(display-mode: standalone)').addEventListener('change', () => {
    globalInstalled = detectInstalled()
    emit()
  })
}

async function runNativePrompt() {
  const event = capturedPrompt
  if (!event) return false
  await event.prompt()
  const { outcome } = await event.userChoice
  capturedPrompt = null
  if (outcome === 'accepted') globalInstalled = true
  emit()
  return true
}

export function usePwaInstall() {
  const [installed, setInstalled] = useState(detectInstalled)
  const [nativeEvent, setNativeEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [fallbackKind, setFallbackKind] = useState<PwaFallbackKind>('generic')

  useEffect(() => {
    capturePwaInstallPrompt()
    setFallbackKind(detectFallbackKind())
    setInstalled(globalInstalled || detectInstalled())
    setNativeEvent(capturedPrompt)
    const onChange = () => {
      setInstalled(globalInstalled || detectInstalled())
      setNativeEvent(capturedPrompt)
    }
    listeners.add(onChange)
    return () => {
      listeners.delete(onChange)
    }
  }, [])

  const promptInstall = useCallback(async () => runNativePrompt(), [])
  const expectsNativePrompt = fallbackKind === 'generic'

  return {
    visible: !installed && (Boolean(nativeEvent) || !expectsNativePrompt),
    canNativeInstall: Boolean(nativeEvent),
    fallbackKind,
    promptInstall,
  }
}
