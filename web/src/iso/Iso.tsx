import type { ReactNode } from 'react'
import { box, cylinder, points, type Vec3 } from './iso'

export type Tone = 'plain' | 'accent' | 'signal' | 'danger' | 'ink'

/** Isometric drawing canvas; decorative unless it gets a label. */
export function IsoSvg({
  viewBox,
  className,
  label,
  children,
}: {
  viewBox: string
  className?: string
  label?: string
  children: ReactNode
}) {
  return (
    <svg
      viewBox={viewBox}
      className={`iso ${className ?? ''}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {children}
    </svg>
  )
}

type Box = { x: number; y: number; z?: number; w: number; d: number; h: number; tone?: Tone; className?: string }

export function IsoBox({ x, y, z = 0, w, d, h, tone = 'plain', className }: Box) {
  const f = box(x, y, z, w, d, h)
  return (
    <g className={`iso-${tone} ${className ?? ''}`}>
      <polygon className="iso-left" points={f.left} />
      <polygon className="iso-right" points={f.right} />
      <polygon className="iso-top" points={f.top} />
    </g>
  )
}

export function IsoCylinder({
  x,
  y,
  z = 0,
  r,
  h,
  tone = 'plain',
  className,
}: {
  x: number
  y: number
  z?: number
  r: number
  h: number
  tone?: Tone
  className?: string
}) {
  const c = cylinder(x, y, z, r, h)
  const l = c.cx - c.rx
  const rt = c.cx + c.rx
  return (
    <g className={`iso-${tone} ${className ?? ''}`}>
      <path
        className="iso-right"
        d={`M${l},${c.topY} L${l},${c.bottomY} A${c.rx},${c.ry} 0 0 0 ${rt},${c.bottomY} L${rt},${c.topY} Z`}
      />
      <ellipse className="iso-top" cx={c.cx} cy={c.topY} rx={c.rx} ry={c.ry} />
    </g>
  )
}

/** Flat polygon on any plane, for screens, doors and markings. */
export function IsoPoly({ p, className }: { p: Vec3[]; className?: string }) {
  return <polygon className={className ?? 'iso-line'} points={points(...p)} />
}
