import { expect, test } from 'bun:test'
import { deckFileName, toAnkiCsv } from '../src/client/anki.ts'

test('a deck becomes one quoted row per card', () => {
  const csv = toAnkiCsv([
    { question: 'What is light?', answer: 'A wave and a particle.' },
    { question: 'What is refraction?', answer: 'The bending of light.' },
  ])
  expect(csv).toBe(
    [
      '"What is light?","A wave and a particle."',
      '"What is refraction?","The bending of light."',
    ].join('\n'),
  )
})

test('quotes and line breaks inside a card survive the CSV', () => {
  const csv = toAnkiCsv([
    { question: 'What did she say?', answer: 'She said "yes".' },
    { question: 'Two lines?', answer: 'First\nSecond' },
  ])
  expect(csv).toContain('"She said ""yes""."')
  expect(csv).toContain('"First\nSecond"')
})

test('the file is named after its deck', () => {
  expect(deckFileName('Flashcards · Light – Reflection')).toBe('light-reflection-anki.csv')
  expect(deckFileName('Flashcards · 10 / 12')).toBe('10-12-anki.csv')
  expect(deckFileName('Flashcards · Hindi')).toBe('hindi-anki.csv')
})
