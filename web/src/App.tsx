import { useEffect, useState, type MouseEvent } from 'react'
import { apiMock } from './config'
import { Logo } from './iso/scenes'
import { links, viewFor } from './routes'
import { Cajero } from './views/Cajero'
import { Operador } from './views/Operador'
import { Tienda } from './views/Tienda'

const views = { cajero: Cajero, tienda: Tienda, operador: Operador }

export function App() {
  const [path, setPath] = useState(location.pathname)

  useEffect(() => {
    const onPop = () => setPath(location.pathname)
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  // In-app navigation keeps the simulated API state alive across views.
  const go = (e: MouseEvent<HTMLAnchorElement>, to: string) => {
    e.preventDefault()
    history.pushState(null, '', to)
    setPath(to)
  }

  const current = viewFor(path)
  const View = views[current]

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <Logo />
          walle
        </span>
        <nav>
          {links.map((l) => (
            <a
              key={l.path}
              href={l.path}
              aria-current={l.view === current ? 'page' : undefined}
              onClick={(e) => go(e, l.path)}
            >
              {l.label}
            </a>
          ))}
        </nav>
        {apiMock && <span className="badge">API simulada · testnet</span>}
      </header>
      <main>
        <View />
      </main>
    </div>
  )
}
