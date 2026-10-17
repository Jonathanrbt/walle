export type View = 'cajero' | 'tienda' | 'operador'

export const links: { path: string; view: View; label: string }[] = [
  { path: '/', view: 'cajero', label: 'Cajero' },
  { path: '/tienda', view: 'tienda', label: 'Tienda' },
  { path: '/operador', view: 'operador', label: 'Operador' },
]

/** Resolves a pathname to its view; unknown paths fall back to the cashier. */
export function viewFor(pathname: string): View {
  const path = pathname.replace(/\/+$/, '') || '/'
  return links.find((l) => l.path === path)?.view ?? 'cajero'
}
