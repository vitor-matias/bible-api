// Ester's Greek additions are marked in the source with \cp A to \cp F and
// numbered with \va. The parser hands each over as one blob of verse objects
// (A in the chapter's front matter, B to F trailing a verse), which used to be
// stored as a single verse. This lays them out as verses of their chapter,
// numbered 1, 2, ... as the printed edition does, after the verse they trail.

type Verses = {
  label: string
  verseObjects: USFMVerseObject[]
  extra?: Partial<Verse>
}[]

const splitAtVa = (objects: USFMVerseObject[]) => {
  const head: USFMVerseObject[] = []
  const verses: { va: string; objs: USFMVerseObject[] }[] = []
  for (const o of objects) {
    if (o.tag === "va") {
      verses.push({ va: (o.content ?? "").trim(), objs: [] })
    } else {
      ;(verses.at(-1)?.objs ?? head).push(o)
    }
  }
  return { head, verses }
}

// The headings inside a supplement, as copies. The ones ending it are the main
// text's ("Banquete de Assuero" after A): they stay as they are.
const markHeadings = (
  objects: USFMVerseObject[],
  { keepTrailing = false } = {},
): USFMVerseObject[] => {
  let end = objects.length
  while (
    keepTrailing &&
    end > 0 &&
    (objects[end - 1].type === "section" ||
      objects[end - 1].type === "paragraph")
  ) {
    end--
  }
  return objects.map((o, i) =>
    o.type === "section" && i < end ? { ...o, supplement: true } : o,
  )
}

const cpLetter = (objects: USFMVerseObject[]) =>
  objects.find((o) => o.tag === "cp")?.content?.trim()

export const splitGreekAdditions = (chapter: USFMChapter): USFMChapter => {
  const keys = Object.keys(chapter)
    .filter((k) => k !== "front")
    // parseInt, not Number: a bridge "8-9" sorts as 8, where Number gives NaN.
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
  const frontObjects = chapter.front?.verseObjects ?? []
  const opening = cpLetter(frontObjects)
  if (
    opening === undefined &&
    !keys.some((k) => cpLetter(chapter[k].verseObjects))
  ) {
    return chapter
  }

  const verses: Verses = []
  let front = chapter.front

  if (opening !== undefined) {
    const { head, verses: added } = splitAtVa(
      frontObjects.filter((o) => o.tag !== "cp"),
    )
    // A supplement opening the chapter is printed under the letter, and the
    // chapter number comes where the numbered text starts.
    front = {
      verseObjects: markHeadings(head),
      extra: { chapterLabel: opening },
    }
    added.forEach(({ va, objs }, i) => {
      verses.push({
        label: va,
        verseObjects: markHeadings(objs, {
          keepTrailing: i === added.length - 1,
        }),
        extra: { supplement: true },
      })
    })
    const last = verses.at(-1)
    if (last) last.extra = { supplement: true, chapterNumberStarts: true }
  }

  for (const key of keys) {
    const objects = chapter[key].verseObjects
    const cpIndex = objects.findIndex((o) => o.tag === "cp")
    if (cpIndex < 0) {
      verses.push({ label: key, verseObjects: objects })
      continue
    }
    const { head, verses: added } = splitAtVa(objects.slice(cpIndex + 1))
    const letter = { supplementLetter: cpLetter(objects) }
    const hasHeading = head.some((o) => o.type === "section")
    verses.push({
      label: key,
      verseObjects: [...objects.slice(0, cpIndex), ...markHeadings(head)],
      ...(hasHeading && { extra: letter }),
    })
    // The text that resumes after an addition (3:14, 3:15 after B) is numbered
    // with \va too: a jump in the count marks where the addition ends.
    let inAddition = true
    const lastInAddition =
      added.findIndex(({ va }, i) => Number(va) !== i + 1) - 1
    added.forEach(({ va, objs }, i) => {
      if (Number(va) !== i + 1) inAddition = false
      const end = lastInAddition < 0 ? added.length - 1 : lastInAddition
      verses.push({
        label: va,
        verseObjects: inAddition
          ? markHeadings(objs, { keepTrailing: i === end })
          : objs,
        ...(inAddition && {
          extra: { supplement: true, ...(!hasHeading && i === 0 && letter) },
        }),
      })
    })
  }

  const result: USFMChapter = {}
  if (front) result.front = front
  verses.forEach((verse, index) => {
    result[String(index + 1)] = {
      verseObjects: verse.verseObjects,
      label: verse.label,
      ...(verse.extra && { extra: verse.extra }),
    }
  })
  return result
}
