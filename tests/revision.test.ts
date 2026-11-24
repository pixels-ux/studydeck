import { expect, test } from 'bun:test'
import {
  parseCards,
  parseSlides,
  revisionKindOf,
} from '../src/client/revision.ts'

test('cards are read from Q/A pairs and wrapped answers keep their lines', () => {
  const cards = parseCards(
    [
      'Q: What drives photosynthesis?',
      'A: Chlorophyll absorbs light, which splits water.',
      '',
      'Q: Where does it happen?',
      'A: In the chloroplasts of leaf cells.',
      'The light energy is stored as glucose.',
    ].join('\n'),
  )
  expect(cards).toHaveLength(2)
  expect(cards[0]).toEqual({
    question: 'What drives photosynthesis?',
    answer: 'Chlorophyll absorbs light, which splits water.',
  })
  expect(cards[1]?.answer).toBe(
    'In the chloroplasts of leaf cells. The light energy is stored as glucose.',
  )
})

test('numbering, bold labels and chatter do not break the cards', () => {
  const cards = parseCards(
    [
      'Here are your flashcards.',
      '',
      '**Q1:** What is a mole?',
      '**A:** A counting unit for particles.',
      '',
      'Q2) State Avogadro’s number.',
      'A2) 6.02 x 10^23.',
    ].join('\n'),
  )
  expect(cards).toHaveLength(2)
  expect(cards[0]?.question).toBe('What is a mole?')
  expect(cards[1]?.answer).toBe('6.02 x 10^23.')
})

test('a card with no answer is left out instead of showing a blank', () => {
  expect(parseCards('Q: Floating question with no answer')).toEqual([])
  expect(parseCards('Just prose, no cards here.')).toEqual([])
})

test('slides are split on --- lines and keep their heading and bullets', () => {
  const slides = parseSlides(
    [
      '# Light',
      '- travels in straight lines',
      '- reflects off surfaces',
      '---',
      '## Refraction',
      '- bends at the boundary',
      '- depends on the medium',
    ].join('\n'),
  )
  expect(slides).toHaveLength(2)
  expect(slides[0]).toEqual({
    heading: 'Light',
    lines: ['travels in straight lines', 'reflects off surfaces'],
  })
  expect(slides[1]?.heading).toBe('Refraction')
})

test('only library revision notes offer the Revise view', () => {
  expect(revisionKindOf('Flashcards · Light')).toBe('cards')
  expect(revisionKindOf('Slides · Light')).toBe('slides')
  expect(revisionKindOf('Summary · Light')).toBeNull()
  expect(revisionKindOf('My own note')).toBeNull()
})
