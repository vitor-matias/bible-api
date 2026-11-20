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

const cpLetter = (objects: USFMVerseObject[]) =>
  objects.find((o) => o.tag === "cp")?.content?.trim()

export const splitGreekAdditions = (chapter: USFMChapter): USFMChapter => {
  const keys = Object.keys(chapter)
    .filter((k) => k !== "front")
    .sort((a, b) => Number(a) - Number(b))
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
    front = { verseObjects: head, extra: { chapterLabel: opening } }
    for (const { va, objs } of added) {
      verses.push({
        label: va,
        verseObjects: objs,
        extra: { supplement: true },
      })
    }
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
      verseObjects: [...objects.slice(0, cpIndex), ...head],
      ...(hasHeading && { extra: letter }),
    })
    // The text that resumes after an addition (3:14, 3:15 after B) is numbered
    // with \va too: a jump in the count marks where the addition ends.
    let inAddition = true
    added.forEach(({ va, objs }, i) => {
      if (Number(va) !== i + 1) inAddition = false
      verses.push({
        label: va,
        verseObjects: objs,
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
