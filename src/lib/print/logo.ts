const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }

/** Turns a picture file (as base64) into a small PNG data URL that can be saved with the school and drawn into PDFs. */
export async function logoFromFile(base64: string, fileName: string, maxSide = 600): Promise<string> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const mime = MIME[ext]
  if (!mime) throw new Error('Please choose a PNG, JPG, GIF, WEBP or SVG picture.')
  const img = new Image()
  await new Promise<void>((ok, bad) => {
    img.onload = () => ok()
    img.onerror = () => bad(new Error('That picture could not be read. Please choose another one.'))
    img.src = `data:${mime};base64,${base64}`
  })
  let w = img.naturalWidth || 300, h = img.naturalHeight || 300
  const k = Math.min(1, maxSide / Math.max(w, h))
  w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d')!.drawImage(img, 0, 0, w, h)
  return c.toDataURL('image/png')
}
