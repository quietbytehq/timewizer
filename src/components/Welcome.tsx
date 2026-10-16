import { useState } from 'react'
import { motion } from 'framer-motion'
import { FolderOpen, Plus } from 'lucide-react'
import { Button, Card, Field, inputCls, inputStyle } from './ui'

export function Welcome({ busy, error, onNew, onOpen }:
  { busy: boolean; error: string | null; onNew: (name: string) => void; onOpen: () => void }) {
  const [name, setName] = useState('')
  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="eyebrow">Welcome</div>
        <h1 className="mt-2 text-5xl font-semibold tracking-tight">Timetables, made simple.</h1>
        <p className="mt-4 max-w-xl text-lg" style={{ color: 'var(--muted)' }}>
          Each school lives in its own file. Start a new school or open one you saved before.
        </p>
      </motion.div>

      {error && (
        <div role="alert" className="mt-8 rounded-xl border px-4 py-3 text-sm font-medium"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>
      )}

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        <Card>
          <h2 className="text-xl font-semibold">New school</h2>
          <div className="mt-4">
            <Field label="School name">
              <input className={inputCls} style={inputStyle} value={name} placeholder="e.g. Riverside Secondary School"
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && name.trim() && onNew(name)} />
            </Field>
          </div>
          <Button kind="primary" className="mt-5 w-full" disabled={busy || !name.trim()} onClick={() => onNew(name)}>
            <Plus size={16} /> Create school
          </Button>
        </Card>
        <Card className="flex flex-col">
          <h2 className="text-xl font-semibold">Open a school</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>Continue with a school file you saved earlier.</p>
          <Button className="mt-auto w-full" disabled={busy} onClick={onOpen}><FolderOpen size={16} /> Open file…</Button>
        </Card>
      </div>
    </main>
  )
}
