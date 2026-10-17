import { useId } from 'react'
import { BILL_DESIGN, BILL_HEIGHT_MM as H, type Bill } from './cash'

/** Mixes a #rrggbb color toward another by t (0..1). */
function mix(a: string, b: string, t: number) {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** Wavy security line across the note. */
const wave = (len: number, y: number, amp: number, period: number, phase = 0) =>
  'M' +
  Array.from(
    { length: Math.ceil(len) + 1 },
    (_, x) => `${x},${(y + amp * Math.sin(x / period + phase)).toFixed(2)}`,
  ).join(' L')

/**
 * Colombian-style banknote drawn in SVG, sized to the real note's proportions.
 * Stylized on purpose: generic portrait, no serials, marked as a specimen.
 */
export function Banknote({ bill, className }: { bill: Bill; className?: string }) {
  const id = useId()
  const { color, words, lengthMm: L } = BILL_DESIGN[bill]
  const deep = mix(color, '#000000', 0.45)
  const pale = mix(color, '#ffffff', 0.6)
  const n = bill / 1000
  const px = L * 0.73

  return (
    <svg className={`bn ${className ?? ''}`} viewBox={`0 0 ${L} ${H}`} width="100%" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={color} />
          <stop offset="0.55" stopColor={pale} />
          <stop offset="1" stopColor={color} />
        </linearGradient>
        <clipPath id={`${id}c`}>
          <ellipse cx={px} cy={31} rx={15} ry={19} />
        </clipPath>
      </defs>

      <rect width={L} height={H} rx={2.5} fill={`url(#${id}g)`} stroke={deep} strokeWidth={0.5} />
      <rect
        x={2}
        y={2}
        width={L - 4}
        height={H - 4}
        rx={1.5}
        fill="none"
        stroke="#fff"
        strokeOpacity={0.55}
        strokeWidth={0.4}
      />

      <g fill="none" stroke="#fff" strokeOpacity={0.4} strokeWidth={0.3}>
        {Array.from({ length: 7 }, (_, i) => (
          <ellipse key={i} cx={L * 0.3} cy={33} rx={8 + i * 4} ry={5 + i * 3} />
        ))}
        <path d={wave(L, 50, 1.6, 2.4)} />
        <path d={wave(L, 53, 1.6, 2.4, Math.PI)} />
        <path d={wave(L, 12, 1.2, 3)} />
      </g>

      <circle cx={L * 0.17} cy={34} r={12} fill="#fff" fillOpacity={0.5} />
      <text x={L * 0.17} y={38} textAnchor="middle" fontSize={10} fontWeight={800} fill={deep} fillOpacity={0.18}>
        {n}
      </text>

      <line x1={L * 0.4} y1={0} x2={L * 0.4} y2={H} stroke={deep} strokeWidth={0.8} strokeDasharray="2 1.4" />

      <ellipse cx={px} cy={31} rx={15} ry={19} fill="#fff" fillOpacity={0.3} stroke={deep} strokeWidth={0.5} />
      <g clipPath={`url(#${id}c)`} fill="none" stroke={deep} strokeWidth={0.6} strokeLinecap="round">
        <circle cx={px} cy={25} r={6.5} />
        <path d={`M${px - 6.5},23 Q${px},14 ${px + 6.5},23`} />
        <path d={`M${px - 13},52 Q${px - 12},34 ${px},33 Q${px + 12},34 ${px + 13},52`} />
        <path d={`M${px - 3},33 L${px},38 L${px + 3},33`} />
      </g>

      <g fill={deep} className="bn-text">
        <text x={6} y={4.4} fontSize={2.3} letterSpacing={0.4} fillOpacity={0.8}>
          MUESTRA · SIN VALOR
        </text>
        <text x={6} y={21} fontSize={16} fontWeight={800} letterSpacing={-0.6}>
          {n}
          <tspan fontSize={5.5} dx={1} fontWeight={700}>
            MIL
          </tspan>
        </text>
        <text x={6} y={28} fontSize={3.6} fontWeight={700} letterSpacing={1}>
          COLOMBIA
        </text>
        <text x={6} y={61} fontSize={3.4} fontWeight={700} letterSpacing={0.5}>
          {words}
        </text>
        <text x={L - 5} y={61} textAnchor="end" fontSize={8} fontWeight={800}>
          {n}.000
        </text>
      </g>
    </svg>
  )
}
