/** World point: x runs right-down, y runs left-down, z runs up. */
export type Vec3 = [number, number, number]

const COS30 = Math.cos(Math.PI / 6)

/** Screen coordinates of a world point in isometric projection. */
export const iso = (x: number, y: number, z = 0): [number, number] => [(x - y) * COS30, (x + y) * 0.5 - z]

const round = (n: number) => String(+n.toFixed(2))

/** SVG `points` attribute for world points. */
export const points = (...p: Vec3[]) =>
  p.map(([x, y, z]) => iso(x, y, z).map(round).join(',')).join(' ')

/** Visible faces of a box: top, left (y = y + d) and right (x = x + w). */
export function box(x: number, y: number, z: number, w: number, d: number, h: number) {
  const t = z + h
  return {
    top: points([x, y, t], [x + w, y, t], [x + w, y + d, t], [x, y + d, t]),
    left: points([x, y + d, z], [x + w, y + d, z], [x + w, y + d, t], [x, y + d, t]),
    right: points([x + w, y, z], [x + w, y + d, z], [x + w, y + d, t], [x + w, y, t]),
  }
}

/** Upright cylinder: a ground circle of radius r projects to an ellipse rx × ry. */
export function cylinder(x: number, y: number, z: number, r: number, h: number) {
  const [cx, baseY] = iso(x, y, z)
  return { cx, topY: baseY - h, bottomY: baseY, rx: r * Math.SQRT2 * COS30, ry: r * Math.SQRT2 * 0.5 }
}
