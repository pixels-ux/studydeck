export type RevisionSheetRow = {
  subjectId: string
  subjectName: string
  chaptersTotal: number
  chaptersDone: number
  chaptersLeft: number
  examDate: string
  daysToExam: string | number
  weeksUntil: number
  overdueTasks: number
  mistakes: number
  status: 'clear' | 'watch' | 'behind'
  revisionHoursPerWeek: number
}

export type RevisionSheetResponse = {
  rows: RevisionSheetRow[]
  today: string
}
