import type { ReactNode } from 'react'

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={`${keyPrefix}-b${index}`}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={`${keyPrefix}-t${index}`}>{part}</span>
    ),
  )
}

/** Minimal renderer for the assistant's plain-text, `- ` bullet replies. */
export default function Prose({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  let counter = 0
  const flush = () => {
    if (!bullets.length) return
    const items = bullets
    blocks.push(
      <ul key={`ul${counter++}`}>
        {items.map((item, index) => (
          <li key={`li${counter}-${index}`}>{inline(item, `li${counter}-${index}`)}</li>
        ))}
      </ul>,
    )
    bullets = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    if (/^[-*•]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*•]\s+/, ''))
      continue
    }
    flush()
    const key = `p${counter++}`
    if (/^#{1,6}\s/.test(line)) blocks.push(<h4 key={key}>{line.replace(/^#{1,6}\s/, '')}</h4>)
    else blocks.push(<p key={key}>{inline(line, key)}</p>)
  }
  flush()
  return <div className="prose">{blocks}</div>
}
