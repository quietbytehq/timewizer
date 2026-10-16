// Stands in for the Tauri desktop shell inside a normal browser: commands go to the Rust
// bridge over HTTP, events are polled, and file dialogs answer from window.__twDialog.
(() => {
  const callbacks = new Map()
  const listeners = new Map() // event -> Map(eventId -> handlerId)
  let nextId = 1
  let since = 0

  const dispatch = (event, payload) => {
    for (const [id, handler] of listeners.get(event) ?? []) callbacks.get(handler)?.({ event, id, payload })
  }
  const poll = async () => {
    try {
      const res = await fetch(`/events?since=${since}`)
      for (const e of (await res.json()).events) {
        since = e.n
        dispatch(e.event, e.payload)
      }
    } catch { /* server busy */ }
    setTimeout(poll, 50)
  }
  poll()

  window.__twDialog = window.__twDialog ?? { open: null, save: null }
  window.__twCalls = []

  window.__TAURI_INTERNALS__ = {
    transformCallback(cb, once) {
      const id = nextId++
      callbacks.set(id, once ? (...a) => { callbacks.delete(id); cb(...a) } : cb)
      return id
    },
    unregisterCallback: id => callbacks.delete(id),
    convertFileSrc: p => p,
    async invoke(cmd, args = {}) {
      if (cmd === 'plugin:event|listen') {
        if (!listeners.has(args.event)) listeners.set(args.event, new Map())
        listeners.get(args.event).set(args.handler, args.handler)
        return args.handler
      }
      if (cmd === 'plugin:event|unlisten') {
        listeners.get(args.event)?.delete(args.eventId)
        return null
      }
      if (cmd === 'plugin:dialog|open') return window.__twDialog.open
      if (cmd === 'plugin:dialog|save') return window.__twDialog.save
      window.__twCalls.push(cmd)
      const res = await fetch('/invoke', { method: 'POST', body: JSON.stringify({ cmd, args }) })
      const body = await res.json()
      if ('err' in body) throw body.err // the app expects the plain message, like Tauri
      return body.ok
    },
  }
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event, id) { listeners.get(event)?.delete(id) },
  }
})()
