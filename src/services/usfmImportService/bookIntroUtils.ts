/**
 * Base USFM tags (without their level suffix) that represent book introduction
 * content. usfm-js reports the numbered forms it finds in the file — `\imt1`,
 * `\is1`, `\io2`, `\ili1` — so tags are matched on their base and the trailing
 * digits are read as the level.
 */
const INTRO_TAG_BASES = new Set([
  "imt",
  "ip",
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

/**
 * Parses a table row content string like "\\th1 Key: \\th2 Value"
 * into an array of cell values: ["Key:", "Value"]
 *
 * Rows may use header cells (\th, \thr) or regular cells (\tc, \tcr).
 */
const parseTableRow = (content: string): string[] => {
  return content
    .split(/\\t(?:hr|cr|h|c)\d+\s*/)
    .filter((cell) => cell.trim().length > 0)
    .map((cell) => cell.trim())
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
  switch (base) {
    case "imt":
      elements.push({ type: "introTitle", level, text: content })
      break

    case "ip":
      elements.push({ type: "introParagraph", text: content })
      break

    case "is":
      elements.push({ type: "introSection", level, text: content })
      break

    case "io":
      elements.push({ type: "introOutline", text: content })
      break

    case "ili":
      elements.push({ type: "introListItem", text: content })
      break

    case "ms":
      elements.push({ type: "introMajorSection", text: content })
      break

    case "tr": {
      const row = parseTableRow(content)
      const lastElement = elements.at(-1)
      // Group consecutive tr rows into a single IntroTable
      if (lastElement?.type === "introTable") {
        lastElement.rows.push(row)
      } else {
        elements.push({ type: "introTable", rows: [row] })
      }
      break
    }
  }
}

type TaggedHeader = {
  header: USFMHeader
  tag: IntroTag
}

/** Keeps only the headers that carry introduction content, with their parsed tag. */
const collectIntroHeaders = (headers: USFMHeader[]): TaggedHeader[] => {
  const introHeaders: TaggedHeader[] = []

  for (const header of headers) {
    const tag = parseIntroTag(header.tag)
    if (tag) introHeaders.push({ header, tag })
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

  return elements.length > 0 ? elements : undefined
}
