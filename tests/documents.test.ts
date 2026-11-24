import { expect, test } from 'bun:test'
import { openDatabase } from '../src/node/sqlite'
import { createApp } from '../src/server/app'
import { documentKind, tidyText } from '../src/server/extract.ts'

function harness() {
  const app = createApp(openDatabase(':memory:'))
  const post = (
    name: string,
    body: string | Uint8Array,
    contentType = 'application/octet-stream',
  ) =>
    app.request(
      `http://localhost/api/library/extract?name=${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: { Origin: 'http://localhost', 'Content-Type': contentType },
        body: body as unknown as BodyInit,
      },
    )
  return { post }
}

/** The smallest PDF with a real text layer, so extraction is not mocked. */
function simplePdf(text: string): Uint8Array {
  const escaped = text.replace(/([()\\])/g, '\\$1')
  const content = `BT /F1 18 Tf 20 150 Td (${escaped}) Tj ET`
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1200 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  bodies.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

test('file kinds come from the extension, then the content type', () => {
  expect(documentKind('A.PDF')).toBe('pdf')
  expect(documentKind('chapter.docx')).toBe('docx')
  expect(documentKind('old.doc')).toBe('doc')
  expect(documentKind('notes.md')).toBe('text')
  expect(documentKind('download', 'application/pdf')).toBe('pdf')
  expect(
    documentKind(
      'download',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ),
  ).toBe('docx')
  expect(documentKind('download', 'text/plain; charset=utf-8')).toBe('text')
  expect(documentKind('photo.jpg', 'image/jpeg')).toBeNull()
})

test('reading a file keeps the words and tidies the blank lines', () => {
  expect(tidyText('  Photosynthesis  \r\nhappens\r\n\r\n\r\nin chloroplasts.  ')).toBe(
    'Photosynthesis\nhappens\n\nin chloroplasts.',
  )
})

test('a text file becomes material ready to review', async () => {
  const { post } = harness()
  const response = await post(
    'chapter 5.txt',
    'Photosynthesis\n\nChlorophyll absorbs light.',
    'application/plain',
  )
  expect(response.status).toBe(200)
  const payload = (await response.json()) as {
    text: string
    truncated: boolean
    characters: number
  }
  expect(payload.text).toBe('Photosynthesis\n\nChlorophyll absorbs light.')
  expect(payload.truncated).toBe(false)
  expect(payload.characters).toBe(payload.text.length)
})

test('a PDF with a text layer is read, not guessed', async () => {
  const { post } = harness()
  const response = await post(
    'chapter.pdf',
    simplePdf('Photosynthesis happens in chloroplasts.'),
    'application/pdf',
  )
  expect(response.status).toBe(200)
  const payload = (await response.json()) as { text: string }
  expect(payload.text).toContain('Photosynthesis happens in chloroplasts.')
})

test('files that cannot be read say what to do instead', async () => {
  const { post } = harness()
  expect((await post('notes.exe', 'hello')).status).toBe(400)

  const doc = await post('old.doc', 'hello')
  expect(doc.status).toBe(400)
  expect(((await doc.json()) as { error: string }).error).toContain('.docx')

  const empty = await post('empty.txt', '', 'text/plain')
  expect(empty.status).toBe(400)
  expect(((await empty.json()) as { error: string }).error).toContain('empty')

  const broken = await post('broken.pdf', '%PDF-1.4 not really a pdf', 'application/pdf')
  expect(broken.status).toBe(400)
  expect((await broken.json()) as { error: string }).toMatchObject({
    error: expect.stringContaining('could not be read'),
  })
})
