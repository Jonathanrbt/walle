import { IsoBox, IsoSvg } from './shapes'

/** Brand mark: a single cube with the accent on top. */
export function Logo() {
  return (
    <IsoSvg viewBox="-1 -1.15 2 2.3">
      <IsoBox x={-0.5} y={-0.5} z={-0.5} w={1} d={1} h={1} />
      <IsoBox x={-0.5} y={-0.5} z={0.35} w={1} d={1} h={0.15} tone="accent" />
    </IsoSvg>
  )
}
