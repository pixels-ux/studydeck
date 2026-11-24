import mammoth from 'mammoth'
import { extractText } from 'unpdf'

/** Files the library can read without the student copying text by hand. */
export type DocumentKind = 'pdf' | 'docx' | 'text'

const TEXT_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/x-markdown',
])

/** The extension wins, then the content type the browser reported. */
export function documentKind(
  name: string,
  contentType = '',
): DocumentKind | 'doc' | null {
  const extension = name.toLowerCase().split('.').pop() ?? ''
  if (extension === 'pdf') return 'pdf'
  if (extension === 'docx') return 'docx'
  if (extension === 'doc') return 'doc'
  if (['txt', 'md', 'markdown', 'csv'].includes(extension)) return 'text'
  const type = contentType.split(';')[0]!.trim().toLowerCase()
  if (type === 'application/pdf') return 'pdf'
  if (type.includes('wordprocessingml')) return 'docx'
  if (TEXT_TYPES.has(type)) return 'text'
  return null
}

/** Line breaks and spare blank lines only: the words are left alone. */
export function tidyText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function readPdf(bytes: Uint8Array): Promise<string> {
  const { text } = await extractText(bytes, { mergePages: true })
  return text
}

async function readDocx(bytes: Uint8Array): Promise<string> {
  const result = await mammoth.extractRawText({
    buffer: Buffer.from(bytes) as unknown as Buffer,
  })
  return result.value
}

/**
 * Text from a PDF, Word document or plain text file. A PDF that is only
 * pictures has no text layer, so that case reports itself instead of saving an
 * empty item.
 */
export async function extractDocument(
  bytes: Uint8Array,
  kind: DocumentKind,
): Promise<string> {
  const raw =
    kind === 'pdf'
      ? await readPdf(bytes)
      : kind === 'docx'
        ? await readDocx(bytes)
        : new TextDecoder().decode(bytes)
  return tidyText(raw)
}
