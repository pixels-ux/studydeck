import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  Entry,
  EntryInput,
  LibraryMessage,
  Note,
  NoteInput,
  Source,
  SourceInput,
  Subject,
  SubjectInput,
  SetupPayload,
  Task,
  TaskInput,
  WorkspaceData,
} from '../shared/types'
import { api } from './api'

export type Workspace = {
  data: WorkspaceData
  saveSubject: (input: SubjectInput, id?: string) => Promise<Subject>
  deleteSubject: (id: string) => Promise<void>
  saveEntry: (input: EntryInput, id?: string) => Promise<Entry>
  deleteEntry: (id: string) => Promise<void>
  replacePlan: (entries: EntryInput[]) => Promise<number>
  /** Replaces only one day's evening plan, from the day check-in. */
  replaceDayPlan: (date: string, entries: EntryInput[]) => Promise<Entry[]>
  toggleChapter: (subjectId: string, chapter: string, done: boolean) => Promise<void>
  saveTask: (input: TaskInput, id?: string) => Promise<Task>
  deleteTask: (id: string) => Promise<void>
  saveNote: (input: NoteInput, id?: string) => Promise<Note>
  deleteNote: (id: string) => Promise<void>
  saveSource: (input: SourceInput, id?: string) => Promise<Source>
  deleteSource: (id: string) => Promise<void>
  /** A note the server made for the student, e.g. a library transformation. */
  adoptNote: (note: Note) => void
  appendLibrary: (messages: LibraryMessage[]) => void
  clearLibrary: (subjectId: string | null) => Promise<void>
  applySetup: (payload: SetupPayload) => Promise<void>
  /** Reloads the workspace, e.g. after a backup was merged in. */
  refresh: () => Promise<void>
  setAiRemaining: (remaining: number) => void
}

const Context = createContext<Workspace | null>(null)

export function useWorkspace(): Workspace {
  const workspace = useContext(Context)
  if (!workspace) throw new Error('Workspace provider is missing.')
  return workspace
}

export function WorkspaceProvider({
  initial,
  children,
}: {
  initial: WorkspaceData
  children: ReactNode
}) {
  const [data, setData] = useState<WorkspaceData>(initial)

  const saveSubject = useCallback(async (input: SubjectInput, id?: string) => {
    const result = await api<{ subject: Subject }>(
      id ? `/api/subjects/${id}` : '/api/subjects',
      { method: id ? 'PATCH' : 'POST', body: input },
    )
    setData((current) => ({
      ...current,
      subjects: id
        ? current.subjects.map((subject) =>
            subject.id === id ? result.subject : subject,
          )
        : [...current.subjects, result.subject],
    }))
    return result.subject
  }, [])

  const deleteSubject = useCallback(async (id: string) => {
    await api<{ ok: boolean }>(`/api/subjects/${id}`, { method: 'DELETE' })
    setData((current) => ({
      ...current,
      subjects: current.subjects.filter((subject) => subject.id !== id),
      entries: current.entries.map((entry) =>
        entry.subjectId === id ? { ...entry, subjectId: null } : entry,
      ),
      tasks: current.tasks.map((task) =>
        task.subjectId === id ? { ...task, subjectId: null } : task,
      ),
      notes: current.notes.map((note) =>
        note.subjectId === id ? { ...note, subjectId: null } : note,
      ),
      sources: current.sources.map((source) =>
        source.subjectId === id ? { ...source, subjectId: null } : source,
      ),
      library: current.library.map((message) =>
        message.subjectId === id ? { ...message, subjectId: null } : message,
      ),
      syllabus: current.syllabus.filter((tick) => tick.subjectId !== id),
    }))
  }, [])

  const toggleChapter = useCallback(
    async (subjectId: string, chapter: string, done: boolean) => {
      await api<{ done: boolean }>('/api/syllabus', {
        method: 'POST',
        body: { subjectId, chapter, done },
      })
      setData((current) => {
        const others = current.syllabus.filter(
          (tick) => !(tick.subjectId === subjectId && tick.chapter === chapter),
        )
        return {
          ...current,
          syllabus: done ? [...others, { subjectId, chapter }] : others,
        }
      })
    },
    [],
  )

  const saveEntry = useCallback(async (input: EntryInput, id?: string) => {
    const result = await api<{ entry: Entry }>(
      id ? `/api/entries/${id}` : '/api/entries',
      { method: id ? 'PATCH' : 'POST', body: input },
    )
    setData((current) => ({
      ...current,
      entries: id
        ? current.entries.map((entry) =>
            entry.id === id ? result.entry : entry,
          )
        : [...current.entries, result.entry],
    }))
    return result.entry
  }, [])

  const deleteEntry = useCallback(async (id: string) => {
    await api<{ ok: boolean }>(`/api/entries/${id}`, { method: 'DELETE' })
    setData((current) => ({
      ...current,
      entries: current.entries.filter((entry) => entry.id !== id),
    }))
  }, [])

  const replacePlan = useCallback(async (entries: EntryInput[]) => {
    const result = await api<{ entries: Entry[] }>('/api/entries/plan', {
      method: 'POST',
      body: { entries },
    })
    setData((current) => ({
      ...current,
      entries: [
        ...current.entries.filter((entry) => entry.plan !== 'intensive'),
        ...result.entries,
      ],
    }))
    return result.entries.length
  }, [])

  const replaceDayPlan = useCallback(
    async (date: string, entries: EntryInput[]) => {
      const result = await api<{ entries: Entry[] }>('/api/entries/day', {
        method: 'POST',
        body: { date, entries },
      })
      setData((current) => ({
        ...current,
        entries: [
          ...current.entries.filter(
            (entry) => !(entry.plan === 'intensive' && entry.date === date),
          ),
          ...result.entries,
        ],
      }))
      return result.entries
    },
    [],
  )

  const saveTask = useCallback(async (input: TaskInput, id?: string) => {
    const result = await api<{ task: Task }>(
      id ? `/api/tasks/${id}` : '/api/tasks',
      { method: id ? 'PATCH' : 'POST', body: input },
    )
    setData((current) => ({
      ...current,
      tasks: id
        ? current.tasks.map((task) => (task.id === id ? result.task : task))
        : [result.task, ...current.tasks],
    }))
    return result.task
  }, [])

  const deleteTask = useCallback(async (id: string) => {
    await api<{ ok: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' })
    setData((current) => ({
      ...current,
      tasks: current.tasks.filter((task) => task.id !== id),
    }))
  }, [])

  const saveNote = useCallback(async (input: NoteInput, id?: string) => {
    const result = await api<{ note: Note }>(
      id ? `/api/notes/${id}` : '/api/notes',
      { method: id ? 'PATCH' : 'POST', body: input },
    )
    setData((current) => {
      const others = current.notes.filter((note) => note.id !== result.note.id)
      return { ...current, notes: [result.note, ...others] }
    })
    return result.note
  }, [])

  const deleteNote = useCallback(async (id: string) => {
    await api<{ ok: boolean }>(`/api/notes/${id}`, { method: 'DELETE' })
    setData((current) => ({
      ...current,
      notes: current.notes.filter((note) => note.id !== id),
    }))
  }, [])

  const saveSource = useCallback(async (input: SourceInput, id?: string) => {
    const result = await api<{ source: Source }>(
      id ? `/api/sources/${id}` : '/api/sources',
      { method: id ? 'PATCH' : 'POST', body: input },
    )
    setData((current) => {
      const others = current.sources.filter(
        (source) => source.id !== result.source.id,
      )
      return { ...current, sources: [result.source, ...others] }
    })
    return result.source
  }, [])

  const deleteSource = useCallback(async (id: string) => {
    await api<{ ok: boolean }>(`/api/sources/${id}`, { method: 'DELETE' })
    setData((current) => ({
      ...current,
      sources: current.sources.filter((source) => source.id !== id),
    }))
  }, [])

  const adoptNote = useCallback((note: Note) => {
    setData((current) => ({
      ...current,
      notes: [note, ...current.notes.filter((item) => item.id !== note.id)],
    }))
  }, [])

  const appendLibrary = useCallback((messages: LibraryMessage[]) => {
    setData((current) => ({
      ...current,
      library: [...current.library, ...messages],
    }))
  }, [])

  const clearLibrary = useCallback(async (subjectId: string | null) => {
    const query = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : ''
    await api<{ ok: boolean }>(`/api/library/messages${query}`, {
      method: 'DELETE',
    })
    setData((current) => ({
      ...current,
      library: current.library.filter(
        (message) => message.subjectId !== subjectId,
      ),
    }))
  }, [])

  const applySetup = useCallback(async (payload: SetupPayload) => {
    const result = await api<WorkspaceData>('/api/setup', {
      method: 'POST',
      body: payload,
    })
    setData(result)
  }, [])

  const refresh = useCallback(async () => {
    setData(await api<WorkspaceData>('/api/data'))
  }, [])

  const setAiRemaining = useCallback((remaining: number) => {
    setData((current) => ({
      ...current,
      ai: { ...current.ai, remaining },
    }))
  }, [])

  const value = useMemo<Workspace>(
    () => ({
      data,
      saveSubject,
      deleteSubject,
      saveEntry,
      deleteEntry,
      replacePlan,
      replaceDayPlan,
      toggleChapter,
      saveTask,
      deleteTask,
      saveNote,
      deleteNote,
      saveSource,
      deleteSource,
      adoptNote,
      appendLibrary,
      clearLibrary,
      applySetup,
      refresh,
      setAiRemaining,
    }),
    [
      data,
      saveSubject,
      deleteSubject,
      saveEntry,
      deleteEntry,
      replacePlan,
      replaceDayPlan,
      toggleChapter,
      saveTask,
      deleteTask,
      saveNote,
      deleteNote,
      saveSource,
      deleteSource,
      adoptNote,
      appendLibrary,
      clearLibrary,
      applySetup,
      refresh,
      setAiRemaining,
    ],
  )

  return <Context.Provider value={value}>{children}</Context.Provider>
}
