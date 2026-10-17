export type Point = { x: number; y: number }
export type Rect = { left: number; top: number; right: number; bottom: number }
export type DropOutcome = 'insert' | 'reject' | 'return'

/** Maximum lean of a dragged note, in degrees. */
export const MAX_TILT = 14

/** Lean of a note held at its grab point while moving at vx px/ms. */
export const tilt = (vx: number) => Math.max(-MAX_TILT, Math.min(MAX_TILT, vx * 18))

export const inside = (p: Point, r: Rect) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom

/** What the cashier does with a note released at p. */
export function dropOutcome(p: Point, target: Rect | null, allowed: boolean): DropOutcome {
  if (!target || !inside(p, target)) return 'return'
  return allowed ? 'insert' : 'reject'
}
