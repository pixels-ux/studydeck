import { useState } from 'react'
import type { Note } from '../shared/types'
import { deckFileName, toAnkiCsv } from './anki'
import { parseCards, parseSlides, revisionKindOf } from './revision'

/** Flip through the cards, or step through the slides, of one note. */
export default function Revision({
  note,
  onClose,
}: {
  note: Note
  onClose: () => void
}) {
  const kind = revisionKindOf(note.title)
  const cards = kind === 'cards' ? parseCards(note.body) : []
  const slides = kind === 'slides' ? parseSlides(note.body) : []
  const total = kind === 'cards' ? cards.length : slides.length
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)

  const step = (delta: number) => {
    setIndex((value) =>
      Math.min(Math.max(value + delta, 0), Math.max(total - 1, 0)),
    )
    setRevealed(false)
  }

  const noun = kind === 'slides' ? 'Slide' : 'Card'

  /** Hands the cards to Anki or any other tool that reads two-column CSV. */
  const exportAnki = () => {
    const blob = new Blob([toAnkiCsv(cards)], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = deckFileName(note.title)
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="drawer-overlay" role="presentation" onClick={onClose}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Revise ${note.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <p className="eyebrow">
              {kind === 'slides' ? 'Presentation' : 'Flashcards'}
            </p>
            <h3>{note.title}</h3>
          </div>
          <div className="drawer-actions">
            {kind === 'cards' && cards.length > 0 ? (
              <button className="btn ghost small" onClick={exportAnki}>
                Export for Anki
              </button>
            ) : null}
            <button
              className="btn ghost small"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="drawer-body">
          {total === 0 ? (
            <p className="empty-line">
              This note has no {kind === 'slides' ? 'slides' : 'cards'} in the
              expected format. Edit it to add some, or make a new set from the
              Library.
            </p>
          ) : (
            <>
              <p className="eyebrow">
                {noun} {index + 1} of {total}
              </p>
              <article className="revision-card">
                {kind === 'cards' ? (
                  <>
                    <h4>{cards[index]!.question}</h4>
                    {revealed ? (
                      <p>{cards[index]!.answer}</p>
                    ) : (
                      <button
                        className="btn primary"
                        onClick={() => setRevealed(true)}
                      >
                        Show answer
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <h4>{slides[index]!.heading}</h4>
                    <ul>
                      {slides[index]!.lines.map((line, position) => (
                        <li key={position}>{line}</li>
                      ))}
                    </ul>
                  </>
                )}
              </article>
              <div className="form-actions">
                <button
                  className="btn ghost"
                  disabled={index === 0}
                  onClick={() => step(-1)}
                >
                  Back
                </button>
                <button
                  className="btn ghost"
                  disabled={index >= total - 1}
                  onClick={() => step(1)}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
