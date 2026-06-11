/**
 * USFM tags that represent book introduction content.
 * These appear in the headers array parsed by usfm-js.
 */
const INTRO_TAGS = new Set([
  "imt",
  "imt2",
  "ip",
  "is",
  "is2",
  "io",
  "tr",
  "ili",
  "ms",
  "esb",
  "esbe",
])

/**
 * Parses a table row content string like "\\th1 Key: \\th2 Value"
 * into an array of cell values: ["Key:", "Value"]
 */
const parseTableRow = (content: string): string[] => {
  return content
    .split(/\\th\d+\s*/)
    .filter((cell) => cell.trim().length > 0)
    .map((cell) => cell.trim())
}

/**
 * Converts a single USFMHeader into an IntroElement and pushes it
 * onto the target array. Handles table row grouping.
 */
const pushElement = (
  elements: IntroElement[],
  header: USFMHeader,
): void => {
  const content = header.content ?? ""

  switch (header.tag) {
    case "imt":
      elements.push({ type: "introTitle", level: 1, text: content })
      break

    case "imt2":
      elements.push({ type: "introTitle", level: 2, text: content })
      break

    case "ip":
      elements.push({ type: "introParagraph", text: content })
      break

    case "is":
      elements.push({ type: "introSection", level: 1, text: content })
      break

    case "is2":
      elements.push({ type: "introSection", level: 2, text: content })
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
      const lastElement = elements[elements.length - 1]
      // Group consecutive tr rows into a single IntroTable
      if (lastElement && lastElement.type === "introTable") {
        lastElement.rows.push(row)
      } else {
        elements.push({ type: "introTable", rows: [row] })
      }
      break
    }
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
  const introHeaders = headers.filter((h) => INTRO_TAGS.has(h.tag))

  if (introHeaders.length === 0) return undefined

  const elements: IntroElement[] = []
  let sidebarContent: IntroElement[] | null = null

  for (const header of introHeaders) {
    if (header.tag === "esb") {
      // Start collecting sidebar content
      sidebarContent = []
      continue
    }

    if (header.tag === "esbe") {
      // Close sidebar and push it as a single element
      if (sidebarContent && sidebarContent.length > 0) {
        elements.push({ type: "introSidebar", content: sidebarContent })
      }
      sidebarContent = null
      continue
    }

    // Skip headers with no content (except structural tags handled above)
    if (!header.content) continue

    // Push into sidebar or top-level depending on context
    pushElement(sidebarContent ?? elements, header)
  }

  if (sidebarContent !== null) {
    console.warn("bookIntroUtils: unclosed \\esb sidebar block — content discarded")
  }

  return elements.length > 0 ? elements : undefined
}

