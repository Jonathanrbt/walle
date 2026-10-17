import { useEffect, useRef, type ReactNode } from 'react'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'borrar', '0', 'ok']

/** One cashier screen asking for a single field, with an on-screen keypad for numbers. */
export function FieldStep({
  step,
  title,
  hint,
  value,
  onChange,
  valid,
  numeric = false,
  maxLength,
  onNext,
  onBack,
}: {
  step: string
  title: string
  hint: ReactNode
  value: string
  onChange: (v: string) => void
  valid: boolean
  numeric?: boolean
  maxLength: number
  onNext: () => void
  onBack: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [step])

  const press = (key: string) => {
    if (key === 'ok') return valid && onNext()
    if (key === 'borrar') return onChange(value.slice(0, -1))
    if (value.length < maxLength) onChange(value + key)
  }

  return (
    <form
      className="atm-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onNext()
      }}
    >
      <p className="atm-kicker">{step}</p>
      <label className="atm-label" htmlFor="atm-field">
        {title}
      </label>
      <input
        id="atm-field"
        ref={input}
        className={`atm-input${value && !valid ? ' atm-input-bad' : ''}`}
        value={value}
        inputMode={numeric ? 'numeric' : 'text'}
        autoComplete="off"
        maxLength={maxLength}
        onChange={(e) => onChange(numeric ? e.target.value.replace(/\D/g, '') : e.target.value)}
        aria-invalid={!!value && !valid}
        aria-describedby="atm-field-hint"
      />
      <p id="atm-field-hint" className="atm-dim">
        {hint}
      </p>
      {numeric && (
        <div className="atm-keypad" aria-label="Teclado numérico">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              className={`atm-key${k === 'ok' ? ' atm-key-ok' : ''}`}
              disabled={k === 'ok' && !valid}
              onClick={() => press(k)}
              aria-label={k === 'borrar' ? 'Borrar' : k === 'ok' ? 'Aceptar' : k}
            >
              {k === 'borrar' ? '⌫' : k === 'ok' ? 'OK' : k}
            </button>
          ))}
        </div>
      )}
      <div className="atm-actions">
        <button type="button" className="atm-btn atm-btn-ghost" onClick={onBack}>
          Atrás
        </button>
        {!numeric && (
          <button type="submit" className="atm-btn" disabled={!valid}>
            Continuar
          </button>
        )}
      </div>
    </form>
  )
}
