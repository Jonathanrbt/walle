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

/** Store with the cashier out front; the cube on the roof turns green while the daily grant is active. */
export function StoreScene({ active }: { active: boolean }) {
  const g = 0.5
  return (
    <IsoSvg viewBox="-8.4 -3.6 17.6 13.6" label={active ? 'Tienda con autorización activa' : 'Tienda sin autorización'}>
      <IsoBox x={0} y={0} z={0} w={10} d={9} h={g} />
      <IsoBox x={1.5} y={1.5} z={g} w={5} d={4} h={3.2} />
      <IsoBox x={1.3} y={1.3} z={g + 3.2} w={5.4} d={4.4} h={0.35} />
      <IsoPoly p={onLeftFace(2.2, 4, 5.5, 1.3, 2.4)} className="iso-line" />
      <IsoPoly p={onLeftFace(4.6, 5.8, 5.5, g, 2.4)} className="iso-fill" />
      <IsoPoly
        p={[
          [2, 5.5, 3.2],
          [6, 5.5, 3.2],
          [6, 6.6, 2.6],
          [2, 6.6, 2.6],
        ]}
        className={active ? 'iso-awning-on' : 'iso-fill'}
      />
      <g className={active ? 'iso-float' : undefined}>
        <IsoBox x={3.4} y={3} z={g + 3.65} w={1.2} d={1.2} h={1.2} tone={active ? 'accent' : 'plain'} />
      </g>
      <IsoBox x={7.2} y={6} z={g} w={1.2} d={1} h={2.2} />
      <IsoPoly p={onLeftFace(7.4, 8.2, 7, 1.8, 2.5)} className="iso-fill" />
    </IsoSvg>
  )
}

/** Operator server with a column of USDC coins: one coin per 10% of the float. */
export function ServerScene({ pct, low }: { pct: number; low: boolean }) {
  const g = 0.5
  const coins = Math.max(0, Math.min(10, Math.round(pct / 10)))
  const [cx, cy] = iso(8, 3, g)
  return (
    <IsoSvg viewBox="-7.6 -2.8 17 12.4" label={`Servidor del operador con ${coins * 10}% de USDC`}>
      <IsoBox x={0} y={0} z={0} w={10} d={8} h={g} />
      <polyline className="iso-dash" points={points([4.9, 3, g], [7, 3, g])} />
      <IsoBox x={1.5} y={1.5} z={g} w={3.4} d={3.4} h={1.5} />
      <IsoBox x={1.5} y={1.5} z={g + 1.5} w={3.4} d={3.4} h={1.5} />
      <Dots x={2.1} y={4.9} z={g + 2.25} />
      {[2.3, 2.6, 2.9].map((y) => (
        <IsoPoly
          key={y}
          p={[
            [4.9, y, g + 1.9],
            [4.9, y, g + 2.6],
          ]}
          className="iso-line"
        />
      ))}
      {coins === 0 && <ellipse className="iso-line" cx={cx} cy={cy} rx={1.1} ry={0.64} />}
      {Array.from({ length: coins }, (_, i) => (
        <IsoCylinder key={i} x={8} y={3} z={g + i * 0.38} r={0.9} h={0.3} tone={low ? 'danger' : 'signal'} />
      ))}
    </IsoSvg>
  )
}
