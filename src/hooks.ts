import { useSyncExternalStore } from 'react'
import { store } from './lib/store'

/** Re-renders when the store changes; returns freshly derived incidents. */
export function useStoreVersion(): number {
  return useSyncExternalStore(store.subscribe, store.getVersion)
}

export function reporterId(): string {
  const k = 'jalrakshak.reporter'
  let id = localStorage.getItem(k)
  if (!id) {
    id = 'rep-' + Math.random().toString(36).slice(2, 12)
    localStorage.setItem(k, id)
  }
  return id
}

export function operatorName(): string {
  return localStorage.getItem('jalrakshak.operator') ?? ''
}

export function setOperatorName(n: string) {
  localStorage.setItem('jalrakshak.operator', n)
}

/** Downscale a chosen image so localStorage is not exhausted (prototype only; production uses object storage). */
export function resizePhoto(file: File, max = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.7))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read this image.'))
    }
    img.src = url
  })
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
