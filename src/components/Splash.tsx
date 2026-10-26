import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { SPLASH_MS } from '@/lib/motion'

/**
 * The short start-up animation: the logo, the name and an amber line. A click or any key skips
 * it. It never blocks anything underneath: the program keeps loading (and opening a school file)
 * while it plays.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, SPLASH_MS)
    const skip = () => onDone()
    window.addEventListener('keydown', skip)
    return () => { clearTimeout(t); window.removeEventListener('keydown', skip) }
  }, [onDone])
  return (
    <motion.div role="presentation" data-testid="splash" onClick={onDone}
      className="fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center"
      style={{ background: 'var(--bg)' }}
      initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }}>
      <motion.img src="/timewizer-logo.svg" alt="" className="h-28 w-28 rounded-3xl"
        style={{ boxShadow: '0 12px 40px rgba(15,34,41,0.25)' }}
        initial={{ opacity: 0, scale: 0.8, rotate: -6 }} animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }} />
      <motion.div className="mt-6 font-serif text-4xl font-semibold tracking-tight"
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.45 }}>
        Timewizer
      </motion.div>
      <motion.div className="mt-3 h-1 rounded-full" style={{ background: 'var(--highlight)' }}
        initial={{ width: 0, opacity: 0 }} animate={{ width: 120, opacity: 1 }} transition={{ delay: 0.55, duration: 0.5, ease: 'easeOut' }} />
      <motion.div className="eyebrow mt-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8, duration: 0.4 }}>
        Timetables, made simple
      </motion.div>
      <span className="sr-only">Starting Timewizer. Press any key to skip.</span>
    </motion.div>
  )
}
