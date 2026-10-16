import type { SchoolSetup } from '@/lib/types'
import { SCHOOL_TYPES } from '@/lib/types'
import { Card, Field, inputCls, inputStyle, Toggle } from './ui'
import { ShiftEditor } from './ShiftEditor'
import { useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { api, errText } from '@/lib/api'
import { logoFromFile } from '@/lib/print/logo'
import { Button } from './ui'

export type Section = 'school' | 'days' | 'shifts' | 'rules'

function LogoField({ setup, onChange }: { setup: SchoolSetup; onChange: (s: SchoolSetup) => void }) {
  const [error, setError] = useState<string | null>(null)
  const choose = async () => {
    setError(null)
    try {
      const path = await api.pickPicture()
      if (!path) return
      const logo = await logoFromFile(await api.readFileBase64(path), path)
      onChange({ ...setup, logo })
    } catch (e) { setError(errText(e)) }
  }
  return (
    <div className="mt-6 border-t pt-6" style={{ borderColor: 'var(--line)' }}>
      <div className="eyebrow">School logo</div>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>Shown on printed timetables, pictures and PDF files. It is not used inside the app.</p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {setup.logo
          ? <img src={setup.logo} alt="School logo" className="h-20 max-w-[12rem] rounded-lg border bg-white object-contain p-1.5" style={{ borderColor: 'var(--line)' }} />
          : <div className="flex h-20 w-32 items-center justify-center rounded-lg border border-dashed text-xs" style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}>No logo yet</div>}
        <Button kind="secondary" onClick={choose}><ImagePlus size={16} /> {setup.logo ? 'Change picture…' : 'Choose a picture…'}</Button>
        {setup.logo && <Button kind="ghost" onClick={() => onChange({ ...setup, logo: null })}><Trash2 size={15} /> Remove</Button>}
      </div>
      {error && <p role="alert" className="mt-3 text-sm font-medium" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}

export function SetupEditor({ section, setup, onChange }:
  { section: Section; setup: SchoolSetup; onChange: (s: SchoolSetup) => void }) {
  if (section === 'school') {
    return (
      <Card>
        <div className="eyebrow">Step 1</div>
        <h2 className="mt-1 text-2xl font-semibold">About the school</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field label="School name">
            <input className={inputCls} style={inputStyle} value={setup.name}
              onChange={e => onChange({ ...setup, name: e.target.value })} />
          </Field>
          <Field label="Academic year" hint="For example 2026-27">
            <input className={inputCls} style={inputStyle} value={setup.academicYear}
              onChange={e => onChange({ ...setup, academicYear: e.target.value })} />
          </Field>
          <Field label="School type">
            <select className={inputCls} style={inputStyle} value={setup.schoolType}
              onChange={e => onChange({ ...setup, schoolType: e.target.value })}>
              {SCHOOL_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
        </div>
        <LogoField setup={setup} onChange={onChange} />
      </Card>
    )
  }

  if (section === 'days') {
    return (
      <Card>
        <div className="eyebrow">Step 2</div>
        <h2 className="mt-1 text-2xl font-semibold">Working days</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>Choose the days the school runs lessons.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {setup.days.map((d, i) => (
            <div key={d.name} className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: 'var(--line)' }}>
              <span className="font-semibold">{d.name}</span>
              <Toggle checked={d.working} label={d.working ? 'Working' : 'Off'}
                onChange={v => onChange({ ...setup, days: setup.days.map((x, k) => (k === i ? { ...x, working: v } : x)) })} />
            </div>
          ))}
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">Step 3</div>
        <h2 className="mt-1 text-2xl font-semibold">Shifts, bell times and breaks</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Each shift has its own periods. Bell times are set per day, so Friday can finish early.
        </p>
      </div>
      {setup.shifts.map((s, i) => (
        <ShiftEditor key={s.id} shift={s} days={setup.days}
          onChange={ns => onChange({ ...setup, shifts: setup.shifts.map((x, k) => (k === i ? ns : x)) })} />
      ))}
    </div>
  )
}
