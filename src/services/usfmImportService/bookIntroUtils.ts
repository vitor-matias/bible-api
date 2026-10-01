import { collapseWhitespace, parseFootnote } from "./storeVerse"

// Intro paragraph variants (indented, quoted, poetic, list-like, closing...)
// that all read as running text; the API has no finer-grained element for them.
const INTRO_PARAGRAPH_BASES = new Set([
  "ip",
  "im",
  "imi",
  "ipi",
  "ipq",
  "imq",
  "ipr",
  "iq",
  "iex",
])

/**
 * Base USFM tags (without their level suffix) that represent book introduction
 * content. usfm-js reports the numbered forms it finds in the file — `\imt1`,
 * `\is1`, `\io2`, `\ili1` — so tags are matched on their base and the trailing
 * digits are read as the level.
 */
const INTRO_TAG_BASES = new Set([
  "imt",
  "imte",
  ...INTRO_PARAGRAPH_BASES,
  "is",
  "io",
  "tr",
  "ili",
  "ms",
  "esb",
  "esbe",
])

type IntroTag = {
  base: string
  level: 1 | 2
}

/**
 * Splits a header tag into its intro base tag and level (`"is2"` -> is/2),
 * or returns null when the tag is not introduction content. Levels beyond 2
 * are clamped, since the API exposes only two heading levels.
 */
const parseIntroTag = (tag: string): IntroTag | null => {
  const match = /^([a-z]+)(\d*)$/.exec(tag)

  if (!match || !INTRO_TAG_BASES.has(match[1])) return null

  const level = match[2] ? Number.parseInt(match[2], 10) : 1

  return { base: match[1], level: level >= 2 ? 2 : 1 }
}

// A note runs from its opening marker to the matching closing one:
// `\f + \fr 1.1 \ft text\f*`, and likewise \fe endnotes and \x
// cross-references.
const NOTE = /\\(f|fe|x) ([\s\S]*?)\\\1\*/g

// Character markers only style the text they wrap (`\bk Gênesis\bk*`, nested
// `\+it`), so the opening marker with its delimiting space and the closing
// marker are dropped and the wrapped text is kept.
const CHARACTER_MARKER = /\\\+?[a-z][a-z0-9]*[* ]?/gi

/**
 * Reduces a header's content to readable text. usfm-js keeps inline markup in
 * header content verbatim, so without this an introduction would be served
 * with raw `\bk ...\bk*` and whole `\f ... \f*` notes in its prose. Notes are
 * lifted out into footnotes, parsed as verse footnotes are.
 */
const cleanIntroText = (content: string): IntroText => {
  const footnotes: _Footnote[] = []
  const withoutNotes = content.replace(NOTE, (_note, _tag, body: string) => {
    footnotes.push(...parseFootnote(body))
    return ""
  })
  const text = collapseWhitespace(withoutNotes.replace(CHARACTER_MARKER, ""))

  return footnotes.length > 0 ? { text, footnotes } : { text }
}

/**
 * Parses a table row content string like "\\th1 Key: \\th2 Value"
 * into an array of cell values: ["Key:", "Value"]
 *
 * Rows may use header cells (\th, \thr) or regular cells (\tc, \tcr).
 */
const parseTableRow = (content: string): string[] => {
  return (
    content
      .split(/\\t(?:hr|cr|h|c)\d+\s*/)
      // A cell is a plain string, so it has nowhere to keep a note; only its
      // prose survives.
      .map((cell) => cleanIntroText(cell).text)
      .filter((cell) => cell.length > 0)
  )
}

/**
 * Converts a single USFMHeader into an IntroElement and pushes it
 * onto the target array. Handles table row grouping.
 */
const pushElement = (
  elements: IntroElement[],
  { base, level }: IntroTag,
  content: string,
): void => {
  if (base === "tr") {
    const row = parseTableRow(content)
    const lastElement = elements.at(-1)
    // Group consecutive tr rows into a single IntroTable
    if (lastElement?.type === "introTable") {
      lastElement.rows.push(row)
    } else {
      elements.push({ type: "introTable", rows: [row] })
    }
    return
  }

  const introText = cleanIntroText(content)

  // Content that was nothing but markup has nothing left to represent.
  if (!introText.text && !introText.footnotes) return

  if (INTRO_PARAGRAPH_BASES.has(base)) {
    elements.push({ type: "introParagraph", ...introText })
    return
  }

  switch (base) {
    case "imt":
    case "imte":
      elements.push({ type: "introTitle", level, ...introText })
      break

    case "is":
      elements.push({ type: "introSection", level, ...introText })
      break

    case "io":
      elements.push({ type: "introOutline", ...introText })
      break

    case "ili":
      elements.push({ type: "introListItem", ...introText })
      break

    case "ms":
      elements.push({ type: "introMajorSection", ...introText })
      break
  }
}

type TaggedHeader = {
  header: USFMHeader
  tag: IntroTag
}

// Markers that start with "i" but carry no introduction content to store
// (identification, encoding, end-of-intro, blank line).
const NON_CONTENT_I_TAGS = new Set(["id", "ide", "ie", "ib"])

/** True for an intro-looking `\i*` marker the importer does not represent. */
const isUnhandledIntroTag = (tag: string): boolean => {
  const match = /^(i[a-z]+)\d*$/.exec(tag)

  return match !== null && !NON_CONTENT_I_TAGS.has(match[1])
}

/** Keeps only the headers that carry introduction content, with their parsed tag. */
const collectIntroHeaders = (headers: USFMHeader[]): TaggedHeader[] => {
  const introHeaders: TaggedHeader[] = []

  for (const header of headers) {
    const tag = parseIntroTag(header.tag)
    if (tag) {
      introHeaders.push({ header, tag })
    } else if (isUnhandledIntroTag(header.tag)) {
      console.warn(
        `bookIntroUtils: ignoring unsupported intro marker \\${header.tag}`,
      )
    }
  }

  return introHeaders
}

/** Closes an open \esb block, pushing it as a single element when it has content. */
const closeSidebar = (
  elements: IntroElement[],
  sidebarContent: IntroElement[] | null,
): void => {
  if (sidebarContent && sidebarContent.length > 0) {
    elements.push({ type: "introSidebar", content: sidebarContent })
  }
}

/**
 * Extracts intro elements from the parsed USFM headers and converts
 * them into properly typed IntroElement objects.
 *
 * usfm-js places intro markers alongside regular headers
 * (id, toc1, toc2, toc3, h) in the headers array.
 *
 * Sidebar blocks (esb/esbe) group their content into IntroSidebar elements.
 */
export const extractBookIntro = (
  headers: USFMHeader[],
): IntroElement[] | undefined => {
  const introHeaders = collectIntroHeaders(headers)

  if (introHeaders.length === 0) return undefined

  const elements: IntroElement[] = []
  let sidebarContent: IntroElement[] | null = null

  for (const { header, tag } of introHeaders) {
    if (tag.base === "esb") {
      // Start collecting sidebar content
      sidebarContent = []
    } else if (tag.base === "esbe") {
      closeSidebar(elements, sidebarContent)
      sidebarContent = null
    } else if (header.content) {
      // Push into sidebar or top-level depending on context; headers with no
      // content carry nothing to represent.
      pushElement(sidebarContent ?? elements, tag, header.content)
    }
  }

  if (sidebarContent !== null) {
    console.warn(
      String.raw`bookIntroUtils: unclosed \esb sidebar block — content discarded`,
    )
  }

  // usfm-js reports everything before the first \c as a header, so a \ms that
  // heads the opening chapter (Psalms' "LIVRO I") arrives here too. A major
  // section with no introduction content after it introduces the body, not
  // the introduction, so it is not stored as one.
  while (elements.at(-1)?.type === "introMajorSection") {
    const heading = elements.pop() as IntroMajorSection
    console.warn(
      String.raw`bookIntroUtils: \ms "${heading.text}" precedes the first chapter, not introduction content; not stored in the introduction`,
    )
  }

  return elements.length > 0 ? elements : undefined
}
