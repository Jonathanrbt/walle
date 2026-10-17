import type { PhaseState } from '../cajero/phases'
import { iso, points, type Vec3 } from './iso'
import { IsoBox, IsoCylinder, IsoPoly, IsoSvg, type Tone } from './shapes'

/** Brand mark: a single cube with the accent on top. */
export function Logo() {
  return (
    <IsoSvg viewBox="-1 -1.15 2 2.3">
      <IsoBox x={-0.5} y={-0.5} z={-0.5} w={1} d={1} h={1} />
      <IsoBox x={-0.5} y={-0.5} z={0.35} w={1} d={1} h={0.15} tone="accent" />
    </IsoSvg>
  )
}

const PHASE_TONE: Record<PhaseState, Tone> = { done: 'accent', active: 'signal', pending: 'plain', error: 'danger' }

/** Timeline marker: one cube per Open Payments phase, colored by its state. */
export function PhaseCube({ state }: { state: PhaseState }) {
  return (
    <IsoSvg viewBox="-1 -1.15 2 2.3">
      <IsoBox x={-0.5} y={-0.5} z={-0.5} w={1} d={1} h={1} tone={PHASE_TONE[state]} />
    </IsoSvg>
  )
}

/** Rectangle drawn on a left-facing wall (constant y): screens, slots, panels. */
const onLeftFace = (x0: number, x1: number, y: number, z0: number, z1: number): Vec3[] => [
  [x0, y, z0],
  [x1, y, z0],
  [x1, y, z1],
  [x0, y, z1],
]

/** Three blue status dots on the left face of a box, like a server front. */
function Dots({ x, y, z }: { x: number; y: number; z: number }) {
  return (
    <g>
      {[0, 0.45, 0.9].map((dx) => {
        const [cx, cy] = iso(x + dx, y, z)
        return <circle key={dx} className="iso-dot" cx={cx} cy={cy} r={0.13} />
      })}
    </g>
  )
}

/** Cash in, Open Payments to the operator, USDC out on Stellar: the whole system on one platform. */
export function AtmScene() {
  const ground = 0.6
  return (
    <IsoSvg viewBox="-9.4 -5.2 20.6 17" className="scene" label="Cajero, operador y billetera Stellar conectados">
      <IsoBox x={0} y={0} z={0} w={12} d={10} h={ground} />
      <polyline className="iso-dash" points={points([5, 4.3, ground], [8, 4.3, ground])} />
      <polyline className="iso-dash" points={points([9.3, 4.6, ground], [9.3, 8.2, ground], [10.2, 8.2, ground])} />

      <IsoBox x={2} y={3} z={ground} w={3} d={2.5} h={6} />
      <IsoBox x={2} y={3} z={ground + 6} w={3} d={2.5} h={0.3} tone="accent" />
      <IsoPoly p={onLeftFace(2.4, 4.6, 5.5, 4.2, 6.1)} className="iso-fill" />
      <IsoPoly p={onLeftFace(2.9, 4.1, 5.5, 3.3, 3.45)} className="iso-ink" />
      <IsoPoly p={onLeftFace(2.6, 3.6, 5.5, 1.6, 2.6)} className="iso-line" />

      <IsoBox x={8} y={2} z={ground} w={2.6} d={2.6} h={1.1} />
      <IsoBox x={8} y={2} z={ground + 1.1} w={2.6} d={2.6} h={1.1} />
      <Dots x={8.6} y={4.6} z={ground + 1.65} />

      {[0, 0.25, 0.5].map((dz) => (
        <IsoBox key={dz} x={2.6} y={6.6} z={ground + dz} w={1.8} d={0.9} h={0.22} tone="accent" />
      ))}

      <g className="iso-float">
        <IsoCylinder x={11} y={8.2} z={1.4} r={0.8} h={0.3} tone="signal" />
      </g>
    </IsoSvg>
  )
}
