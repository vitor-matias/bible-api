// Ester's Greek additions are marked in the source with \cp A to \cp F and
// numbered with \va. The parser hands each over as one blob of verse objects
// (A in the chapter's front matter, B to F trailing a verse), which used to be
// stored as a single verse. This lays them out as the printed edition does:
// lettered verses (A1, A2, ...) where the text puts them, inside their chapter.

type Verses = { label: string; verseObjects: USFMVerseObject[] }[]

// A heading or paragraph break ahead of a \va belongs to that verse, but the
// parser leaves it at the end of the previous one.
const isLeading = (o: USFMVerseObject) =>
  o.type === "section" || o.type === "paragraph"

const takeTrailingLeading = (objects: USFMVerseObject[]) => {
  const taken: USFMVerseObject[] = []
  while (objects.length > 0 && isLeading(objects[objects.length - 1])) {
    taken.unshift(objects.pop() as USFMVerseObject)
  }
  return taken
}

// `headOpens`: the headings ahead of the first \va open that verse; without it
// they stay in the head (a chapter's own opening headings).
const splitAtVa = (objects: USFMVerseObject[], headOpens = true) => {
  const head: USFMVerseObject[] = []
  const verses: { va: string; objs: USFMVerseObject[] }[] = []
  for (const o of objects) {
    if (o.tag === "va") {
      const previous = verses.at(-1)?.objs
      verses.push({
        va: (o.content ?? "").trim(),
        objs: previous
          ? takeTrailingLeading(previous)
          : headOpens
            ? takeTrailingLeading(head)
            : [],
      })
    } else {
      ;(verses.at(-1)?.objs ?? head).push(o)
    }
  }
  return { head, verses }
}

const cpLetter = (objects: USFMVerseObject[]) =>
  objects.find((o) => o.tag === "cp")?.content?.trim()

export const splitGreekAdditions = (chapter: USFMChapter): USFMChapter => {
  const keys = Object.keys(chapter)
    .filter((k) => k !== "front")
    .sort((a, b) => Number(a) - Number(b))
  const frontObjects = chapter.front?.verseObjects ?? []
  if (
    cpLetter(frontObjects) === undefined &&
    !keys.some((k) => cpLetter(chapter[k].verseObjects))
  ) {
    return chapter
  }

  const verses: Verses = []
  let pending: USFMVerseObject[] = []
  const push = (label: string, objects: USFMVerseObject[]) => {
    verses.push({ label, verseObjects: [...pending, ...objects] })
    pending = []
  }

  // Appends one addition's verses; the text that resumes after it comes
  // numbered with \va too (3:14, 3:15 after B), which a jump in the count marks.
  const pushAddition = (
    letter: string,
    objects: { va: string; objs: USFMVerseObject[] }[],
  ) => {
    let expected = 1
    let inAddition = true
    for (const { va, objs } of objects) {
      if (Number(va) !== expected) inAddition = false
      push(inAddition ? `${letter}${va}` : va, objs)
      expected++
    }
    // Headings ending an addition open the verse after it.
    pending = takeTrailingLeading(verses.at(-1)?.verseObjects ?? [])
  }

  let front = chapter.front
  const opening = cpLetter(frontObjects)
  if (opening !== undefined) {
    const { head, verses: added } = splitAtVa(
      frontObjects.filter((o) => o.tag !== "cp"),
      false,
    )
    front = { verseObjects: head }
    pushAddition(opening, added)
  }

  for (const key of keys) {
    const objects = chapter[key].verseObjects
    const cpIndex = objects.findIndex((o) => o.tag === "cp")
    if (cpIndex < 0) {
      push(key, objects)
      continue
    }
    const { head, verses: added } = splitAtVa(objects.slice(cpIndex + 1))
    push(key, [...objects.slice(0, cpIndex), ...head])
    pushAddition(cpLetter(objects) as string, added)
  }
  // Nothing follows: they stay where the source put them.
  if (pending.length > 0) verses.at(-1)?.verseObjects.push(...pending)

  const result: USFMChapter = {}
  if (front) result.front = front
  verses.forEach((verse, index) => {
    result[String(index + 1)] = {
      verseObjects: verse.verseObjects,
      label: verse.label,
    }
  })
  return result
}
