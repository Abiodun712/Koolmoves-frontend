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

function startGlobalListeners() {
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

export function usePwaInstall() {
  const [installed, setInstalled] = useState(detectInstalled)
  const [nativeEvent, setNativeEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [fallbackKind, setFallbackKind] = useState<PwaFallbackKind>('generic')

  useEffect(() => {
    startGlobalListeners()
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

  const promptInstall = useCallback(async () => {
    if (!capturedPrompt) return
    const event = capturedPrompt
    await event.prompt()
    const { outcome } = await event.userChoice
    capturedPrompt = null
    if (outcome === 'accepted') globalInstalled = true
    emit()
  }, [])

  return {
    visible: !installed,
    canNativeInstall: Boolean(nativeEvent),
    fallbackKind,
    promptInstall,
  }
}
