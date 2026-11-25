import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { findTemplate } from "./jingle"

describe("findTemplate", () => {
  const sound = Float32Array.from(
    { length: 400 },
    (_, i) => Math.sin(i * 0.37) * Math.cos(i * 0.011),
  )

  it("finds the template where it sits in the signal, scoring near 1", () => {
    const signal = new Float32Array(2000)
    signal.set(sound, 816)
    const { index, score } = findTemplate(signal, sound)
    assert.equal(index, 816)
    assert.ok(score > 0.99, `score ${score}`)
  })

  it("scores low where the sound isn't there", () => {
    const noise = Float32Array.from(
      { length: 2000 },
      (_, i) => Math.sin(i * 1.7) * 0.2,
    )
    assert.ok(findTemplate(noise, sound).score < 0.6)
  })
})
