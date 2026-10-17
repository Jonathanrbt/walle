import { describe, expect, it } from 'vitest'
import { box, cylinder, iso, points } from './iso'

describe('iso', () => {
  it('projects the three world axes', () => {
    const [x1, y1] = iso(1, 0, 0)
    expect(x1).toBeCloseTo(0.866, 3)
    expect(y1).toBeCloseTo(0.5)
    const [x2, y2] = iso(0, 1, 0)
    expect(x2).toBeCloseTo(-0.866, 3)
    expect(y2).toBeCloseTo(0.5)
    expect(iso(0, 0, 1)).toEqual([0, -1])
  })

  it('formats polygon points with two decimals', () => {
    expect(points([0, 0, 0], [1, 0, 0])).toBe('0,0 0.87,0.5')
  })

  it('returns the three visible faces of a box', () => {
    const b = box(0, 0, 0, 1, 1, 1)
    expect(b.top.startsWith('0,-1 ')).toBe(true)
    expect(b.top.split(' ')).toHaveLength(4)
    expect(b.right.split(' ')).toContain('0,1')
  })

  it('sizes a cylinder ellipse', () => {
    const c = cylinder(0, 0, 0, 1, 2)
    expect(c.rx).toBeCloseTo(1.2247, 4)
    expect(c.ry).toBeCloseTo(0.7071, 4)
    expect(c.topY).toBe(-2)
    expect(c.bottomY).toBe(0)
  })
})
