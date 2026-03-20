import { useState, useEffect, useRef } from 'react'
import { Star, Moon, Zap, Sunset, CloudLightning, Eye, Hexagon, Circle, Activity } from 'react-feather'
import type { FC } from 'react'

interface ThemeDef {
  id: string
  label: string
  icon: FC<{ size?: number }>
  custom?: boolean
}

const THEMES: ThemeDef[] = [
  { id: 'nebula',    label: 'Nebula',     icon: Star,           custom: true },
  { id: 'deepspace', label: 'Deep Space', icon: Circle,         custom: true },
  { id: 'plasma',    label: 'Plasma',     icon: Activity,       custom: true },
  { id: 'night',     label: 'Night',      icon: Moon },
  { id: 'synthwave', label: 'Synthwave',  icon: Zap },
  { id: 'cyberpunk', label: 'Cyberpunk',  icon: Hexagon },
  { id: 'dracula',   label: 'Dracula',    icon: Eye },
  { id: 'dim',       label: 'Dim',        icon: CloudLightning },
  { id: 'sunset',    label: 'Sunset',     icon: Sunset },
]

export function ThemeSelector() {
  const [theme, setTheme] = useState(() => {
    return (typeof localStorage !== 'undefined' && localStorage.getItem('theme')) || 'night'
  })
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const current = THEMES.find(t => t.id === theme) ?? THEMES[0]
  const Icon = current.icon

  const customThemes = THEMES.filter(t => t.custom)
  const presetThemes = THEMES.filter(t => !t.custom)

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn btn-ghost btn-sm gap-1.5"
        onClick={() => setOpen(!open)}
      >
        <Icon size={14} />
        <span className="hidden sm:inline text-xs">{current.label}</span>
        <svg className="w-3 h-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-base-200 border border-base-300 rounded-lg shadow-xl z-50 w-48 p-1.5">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-base-content/30">
            Space
          </div>
          {customThemes.map((t) => {
            const TIcon = t.icon
            return (
              <button
                key={t.id}
                className={`flex items-center gap-2.5 w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
                  theme === t.id ? 'bg-primary/15 text-primary' : 'hover:bg-base-300 text-base-content/70'
                }`}
                onClick={() => { setTheme(t.id); setOpen(false) }}
              >
                <TIcon size={14} />
                <span>{t.label}</span>
              </button>
            )
          })}

          <div className="my-1.5 border-t border-base-300" />

          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-base-content/30">
            Presets
          </div>
          {presetThemes.map((t) => {
            const TIcon = t.icon
            return (
              <button
                key={t.id}
                className={`flex items-center gap-2.5 w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
                  theme === t.id ? 'bg-primary/15 text-primary' : 'hover:bg-base-300 text-base-content/70'
                }`}
                onClick={() => { setTheme(t.id); setOpen(false) }}
              >
                <TIcon size={14} />
                <span>{t.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
