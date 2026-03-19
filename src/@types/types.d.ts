declare module "usfm-js" {
  export function toJSON(input: string): USFMBook
}

type USFMBook = {
  code: string
  headers: USFMHeader[]
  chapters: {
    [chapterNumber: string]: USFMChapter
  }
}

type USFMHeader = {
  tag: string
  content?: string
}

type USFMChapter = {
  [verseNumber: string]: USFMVerse
  front?: USFMVerse
}

type USFMVerse = {
  verseObjects: USFMVerseObject[]
}

type Footnote = {
  tag: "f"
  type: "footnote"
  content: string
  endTag: string
}

type Text = {
  type: "text"
  text: string
}

type USFMVerseObject = {
  tag?: string
  type: string
  content?: string
  endTag?: string
  text?: string
  nextChar?: string
}

type Book = {
  id: string
  name: string
  shortName: string
  abrv: string
  chapterCount: number
  introduction?: IntroElement[]
  chapters?: Chapter[]
}

type IntroElement =
  | IntroTitle
  | IntroParagraph
  | IntroSection
  | IntroOutline
  | IntroTable
  | IntroListItem
  | IntroSidebar
  | IntroMajorSection

type IntroTitle = {
  type: "introTitle"
  level: number
  text: string
}

type IntroParagraph = {
  type: "introParagraph"
  text: string
}

type IntroSection = {
  type: "introSection"
  level: number
  text: string
}

type IntroOutline = {
  type: "introOutline"
  text: string
}

type IntroTable = {
  type: "introTable"
  rows: string[][]
}

type IntroListItem = {
  type: "introListItem"
  text: string
}

type IntroSidebar = {
  type: "introSidebar"
  content: IntroElement[]
}

type IntroMajorSection = {
  type: "introMajorSection"
  text: string
}

type Chapter = {
  bookId: Book["id"]
  number: number
  introduction?: string
  verses?: Verse[]
  title?: string
}

type Verse = {
  bookId: Book["id"]
  chapterNumber: Chapter["number"]
  number: number
  numberLabel: string
  text: (_Text | Section | Paragraph | Quote | References | _Footnote)[]
  searchId: string
}

type Section = {
  type: "section"
  tag: string
  text: string
  normalizedText: string
}

type _Text = {
  type: "text"
  text: string
  normalizedText: string
  allCaps?: boolean
}

type _Footnote = {
  type: "footnote"
  text: string
  reference: string
}

type Paragraph = {
  type: "paragraph"
  text: string
  normalizedText: string
}

type Quote = {
  type: "quote"
  text: string
  normalizedText: string
  identLevel: number
}

type References = {
  type: "references"
  text: string
  normalizedText: string
}

type VersePage = {
  verses: Verse[]
  total: number
  currentPage: number
  totalPages: number
}
