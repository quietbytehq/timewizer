// In-page benchmark driver. Performs the same steps as large-school.spec.ts (open the school, Master
// view, zoom, shift, scroll, pick up a lesson, drop it, undo) from inside the page, so it can run in
// any engine, including WebKitGTK, the engine the Ubuntu app uses. Results are written through the
// bridge's write_file command. Start it with: bench.html?file=<school.twz>&out=<results.json>
// It is only used by `npm run bench:webkit`; it is not part of the app.
(async () => {
  const q = new URLSearchParams(location.search)
  const FILE = q.get('file'), OUT = q.get('out')
  const res = { engine: navigator.userAgent, steps: {}, ipc: {}, notes: [] }
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const paint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now()))))
  const waitFor = async (fn, what, timeout = 120000) => {
    const t0 = performance.now()
    for (;;) {
      const v = fn()
      if (v) return v
      if (performance.now() - t0 > timeout) throw new Error('timed out waiting for ' + what)
      await sleep(5)
    }
  }
  const byText = (sel, text, exact = false) => [...document.querySelectorAll(sel)].find(e => exact ? e.textContent.trim() === text : e.textContent.includes(text))

  // frame gaps and event-loop lag
  const gaps = []; let lastFrame = performance.now()
  const tick = t => { gaps.push(t - lastFrame); lastFrame = t; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  const lags = []; let lastBeat = performance.now()
  setInterval(() => { const n = performance.now(); lags.push(n - lastBeat - 10); lastBeat = n }, 10)
  const resetJank = () => { gaps.length = 0; lags.length = 0 }
  const jank = name => { res.steps[name + ' · slowest frame'] = Math.max(0, ...gaps.slice(1)); res.steps[name + ' · worst event-loop stall'] = Math.max(0, ...lags) }
  const timed = async (name, fn) => {
    resetJank(); const t0 = performance.now(); const r = await fn(); const t1 = await paint()
    res.steps[name] = t1 - t0; jank(name); return r
  }

  // command round trips and the moment a move has been drawn
  const mark = { moved: 0, drop: 0, dragstart: 0, lit: 0 }
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const t0 = performance.now(); const r = await realFetch(input, init)
    if (String(input).endsWith('/invoke') && init && init.body) {
      const cmd = JSON.parse(init.body).cmd; const ms = performance.now() - t0
      ;(res.ipc[cmd] ||= []).push(ms)
      if (cmd === 'move_card' || cmd === 'swap_cards') paint().then(t => { mark.moved = t })
    }
    return r
  }
  new MutationObserver(() => {
    if (mark.dragstart && !mark.lit && document.querySelector('td div[style*="outline"]')) mark.lit = performance.now()
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style'], childList: true })

  const finish = async () => {
    const text = JSON.stringify(res, null, 2)
    try { await realFetch('/invoke', { method: 'POST', body: JSON.stringify({ cmd: 'write_file', args: { path: OUT, dataBase64: btoa(unescape(encodeURIComponent(text))) } }) }) } catch (e) { /* ignore */ }
    document.title = 'BENCH-DONE'
    document.body.setAttribute('data-bench', 'done')
  }
  try {
    await waitFor(() => byText('button', 'Open file'), 'the welcome page')
    window.__twDialog.open = FILE
    await timed('open the school file', async () => {
      byText('button', 'Open file').click()
      await waitFor(() => byText('*', 'Crescent Double-Shift School') , 'school name')
    })
    await timed('go to the Timetable page', async () => {
      byText('nav button', 'Timetable', true).click()
      await waitFor(() => byText('h2', 'Timetable', true), 'Timetable heading')
    })
    await timed('class view -> Master view', async () => {
      byText('[role=tab]', 'Master', true).click()
      await waitFor(() => byText('th', '6A', true), 'row 6A')
    })
    await timed('zoom in once', async () => { document.querySelector('[aria-label="Zoom in"]').click() })
    await timed('zoom out once', async () => { document.querySelector('[aria-label="Zoom out"]').click() })
    const setSelect = (sel, label) => {
      const opt = [...sel.options].find(o => o.textContent.includes(label))
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, opt.value)
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await timed('Master: morning -> afternoon shift', async () => {
      setSelect(document.querySelector('select[aria-label="Shift"]'), 'Afternoon')
      await waitFor(() => byText('th', 'KGA', true), 'row KGA')
    })
    setSelect(document.querySelector('select[aria-label="Shift"]'), 'Morning')
    await waitFor(() => byText('th', '6A', true), 'row 6A again')
    await sleep(300)

    // scroll the whole grid, 150 px at a time
    const box = document.querySelector('div.overflow-auto')
    resetJank()
    for (let i = 0; i < 40; i++) { box.scrollTop += 150; await paint() }
    jank('scroll the Master grid (40 steps)')
    box.scrollTop = 0
    await waitFor(() => byText('th', '6A', true), 'row 6A after scrolling back')
    await sleep(300)

    // pick up lessons until one has a free slot
    const dt = () => { try { return new DataTransfer() } catch (e) { return undefined } }
    const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt() }))
    const chips = [...document.querySelectorAll('div[draggable="true"]')].filter(c => /^(Mathematics|English|Urdu) /.test(c.title))
    let target = null, dragged = null
    for (let i = 0; i < chips.length && !target; i += 7) {
      const chip = chips[i]
      resetJank(); mark.dragstart = performance.now(); mark.lit = 0
      fire(chip, 'dragstart')
      await waitFor(() => mark.lit, 'coloured slots')
      await paint()
      const cells = [...document.querySelectorAll('td div:not([draggable])[style*="outline"]:is([style*="var(--success)"], [style*="var(--warning)"])')].filter(c => !c.querySelector('[draggable]'))
      if (cells.length) {
        target = cells[0]; dragged = chip
        res.steps['drag: pick up -> slots coloured'] = mark.lit - mark.dragstart
        jank('drag: pick up')
      } else { fire(chip, 'dragend'); await sleep(100) }
    }
    if (!target) throw new Error('no lesson with a free slot')
    resetJank()
    fire(target, 'dragenter'); fire(target, 'dragover')
    await paint(); jank('drag: over a free slot')
    resetJank(); mark.drop = performance.now(); mark.moved = 0
    fire(target, 'drop'); fire(dragged, 'dragend')
    await waitFor(() => mark.moved, 'the move to be drawn')
    res.steps['drop -> lesson moved and grid repainted'] = mark.moved - mark.drop
    jank('drop')
    await timed('undo', async () => { byText('button', 'Undo').click() })
    // a second pick-up, right after
    const chip2 = [...document.querySelectorAll('div[draggable="true"]')].filter(c => /^English /.test(c.title))[3]
    resetJank(); mark.dragstart = performance.now(); mark.lit = 0
    fire(chip2, 'dragstart')
    await waitFor(() => mark.lit, 'coloured slots (second)')
    res.steps['drag again: pick up -> slots coloured'] = mark.lit - mark.dragstart
    fire(chip2, 'dragend')

    // every page
    const pages = ['School', 'Working days', 'Shifts & bells', 'Rules & limits', 'Subjects', 'Teachers', 'Classes', 'Rooms', 'Lessons', 'Workload', 'Import data', 'Check before building', 'Build timetable', 'Timetable', 'Print & export']
    for (const p of pages) await timed('page: ' + p, async () => { byText('nav button', p, true).click() })
    for (const k of Object.keys(res.ipc)) { const v = res.ipc[k]; res.ipc[k] = { n: v.length, max: Math.max(...v), median: v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)] } }
    res.ok = true
  } catch (e) {
    res.ok = false; res.error = String(e && e.message || e)
  }
  await finish()
})()
