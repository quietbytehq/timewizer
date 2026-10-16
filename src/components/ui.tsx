import type { ButtonHTMLAttributes, ReactNode } from 'react'

export const surface = { background: 'var(--surface)', borderColor: 'var(--line)' }

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border p-6 shadow-sm ${className}`} style={surface}>{children}</section>
}

export function Field({ label, hint, group = false, children }: { label: string; hint?: string; group?: boolean; children: ReactNode }) {
  // A "group" holds several controls (checkboxes, buttons): a <label> around them would name only the first one.
  const Tag = group ? 'div' : 'label'
  return (
    <Tag className="block" {...(group ? { role: 'group', 'aria-label': label } : {})}>
      <span className="eyebrow">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs" style={{ color: 'var(--muted)' }}>{hint}</span>}
    </Tag>
  )
}

export const inputCls = 'w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[var(--highlight)]'
export const inputStyle = { backgroundColor: 'var(--bg)', borderColor: 'var(--line)', color: 'var(--ink)' }

export function Button({ kind = 'secondary', className = '', ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const style =
    kind === 'primary' ? { background: 'var(--highlight)', color: '#18343F' }
    : kind === 'danger' ? { background: 'transparent', color: 'var(--danger)', borderColor: 'var(--danger)' }
    : kind === 'ghost' ? { background: 'transparent', color: 'var(--ink)' }
    : { background: 'var(--ink)', color: 'var(--on-ink)' }
  return (
    <button {...p} style={{ ...style, ...p.style }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl border border-transparent px-4 py-2 text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${className}`} />
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className="relative h-6 w-11 rounded-full transition"
        style={{ background: checked ? 'var(--accent)' : 'var(--line)' }}>
        <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
          style={{ left: checked ? '1.35rem' : '0.15rem' }} />
      </button>
      {label}
    </label>
  )
}
