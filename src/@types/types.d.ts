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

// The prose of a text-bearing intro element, with any notes the source attached
// to it lifted out into their own list rather than left inline as markup.
type IntroText = {
  text: string
  footnotes?: _Footnote[]
}

type IntroTitle = IntroText & {
  type: "introTitle"
  level: 1 | 2
}

type IntroParagraph = IntroText & {
  type: "introParagraph"
}

type IntroSection = IntroText & {
  type: "introSection"
  level: 1 | 2
}

type IntroOutline = IntroText & {
  type: "introOutline"
}

type IntroTable = {
  type: "introTable"
  rows: string[][]
}

type IntroListItem = IntroText & {
  type: "introListItem"
}

type IntroSidebar = {
  type: "introSidebar"
  content: IntroElement[]
}

type IntroMajorSection = IntroText & {
  type: "introMajorSection"
}

// Front-matter introductions (USFM \id FRT / INT). Stored outside the book
// namespace because every such file shares one id, and outside every search
// index because introductions are not search content.
type BookIntro = {
  slug: string
  name: string
  introduction: IntroElement[]
}

type IntroSummary = Pick<BookIntro, "slug" | "name">

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
