import { describe, it, expect } from 'vitest'
import { easeIn, easeOut, easeInOut } from '../engine/templates.js'

describe('easeIn(t)', () => {
  it('returns 0 at t=0', () => {
    expect(easeIn(0)).toBe(0)
  })

  it('returns 1 at t=1', () => {
    expect(easeIn(1)).toBe(1)
  })

  it('returns 0.25 at t=0.5 (quadratic)', () => {
    expect(easeIn(0.5)).toBeCloseTo(0.25, 9)
  })

  it('output is in [0, 1] for all t in [0, 1]', () => {
    for (let i = 0; i <= 100; i++) {
      const t = i / 100
      const v = easeIn(t)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('is monotonically non-decreasing on [0, 1]', () => {
    let prev = -Infinity
    for (let i = 0; i <= 100; i++) {
      const v = easeIn(i / 100)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })
})

describe('easeOut(t)', () => {
  it('returns 0 at t=0', () => {
    expect(easeOut(0)).toBe(0)
  })

  it('returns 1 at t=1', () => {
    expect(easeOut(1)).toBe(1)
  })

  it('returns 0.75 at t=0.5 (1-(0.5)²)', () => {
    expect(easeOut(0.5)).toBeCloseTo(0.75, 9)
  })

  it('output is in [0, 1] for all t in [0, 1]', () => {
    for (let i = 0; i <= 100; i++) {
      const t = i / 100
      const v = easeOut(t)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('is monotonically non-decreasing on [0, 1]', () => {
    let prev = -Infinity
    for (let i = 0; i <= 100; i++) {
      const v = easeOut(i / 100)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })

  it('easeOut > easeIn in the middle (concave vs convex)', () => {
    for (let i = 1; i < 100; i++) {
      const t = i / 100
      expect(easeOut(t)).toBeGreaterThan(easeIn(t))
    }
  })
})

describe('easeInOut(t)', () => {
  it('returns 0 at t=0', () => {
    expect(easeInOut(0)).toBe(0)
  })

  it('returns 1 at t=1', () => {
    expect(easeInOut(1)).toBe(1)
  })

  it('returns exactly 0.5 at t=0.5 (symmetric midpoint)', () => {
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 9)
  })

  it('output is in [0, 1] for all t in [0, 1]', () => {
    for (let i = 0; i <= 100; i++) {
      const t = i / 100
      const v = easeInOut(t)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('is monotonically non-decreasing on [0, 1]', () => {
    let prev = -Infinity
    for (let i = 0; i <= 100; i++) {
      const v = easeInOut(i / 100)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })

  it('is symmetric: easeInOut(t) + easeInOut(1-t) == 1', () => {
    for (let i = 0; i <= 100; i++) {
      const t = i / 100
      expect(easeInOut(t) + easeInOut(1 - t)).toBeCloseTo(1, 9)
    }
  })

  it('first half (t<0.5) is slower than a linear curve (concave up)', () => {
    for (let i = 1; i < 50; i++) {
      const t = i / 100
      expect(easeInOut(t)).toBeLessThan(t)
    }
  })

  it('second half (t>0.5) is faster than a linear curve (concave down)', () => {
    for (let i = 51; i < 100; i++) {
      const t = i / 100
      expect(easeInOut(t)).toBeGreaterThan(t)
    }
  })
})
