// Detects colliding path claims between active team tasks (team/tasks/*.md).
// Usage:
//   node scripts/team/check-overlap.mjs                  exit 1 if active tasks collide
//   node scripts/team/check-overlap.mjs --status         table of all tasks
//   node scripts/team/check-overlap.mjs --paths a b/**   would these paths collide with active tasks?
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const tasksDir = join(root, 'team', 'tasks')

export function parseTask(text, file) {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  const task = { file, owner: '?', status: 'todo', paths: [], shared: [] }
  if (!m) return task
  let list = null
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.+?)\s*$/)
    if (item && list) { task[list].push(item[1].replace(/^["']|["']$/g, '')); continue }
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (!kv) continue
    list = null
    const [, key, val] = kv
    if (key === 'paths' || key === 'shared') {
      list = key
      const inline = val.match(/^\[(.*)\]$/)
      if (inline) { task[key] = inline[1].split(',').map(s => s.trim()).filter(Boolean); list = null }
    } else task[key] = val.replace(/^["']|["']$/g, '')
  }
  return task
}

// Static directory prefix of a path/glob, as segments.
function prefix(p) {
  const segs = p.replace(/^\.\//, '').split('/')
  const out = []
  for (const s of segs) { if (/[*?[{]/.test(s)) break; out.push(s) }
  return out
}

// Conservative: collide when one static prefix contains the other.
export function collide(a, b) {
  const pa = prefix(a), pb = prefix(b)
  const n = Math.min(pa.length, pb.length)
  for (let i = 0; i < n; i++) if (pa[i] !== pb[i]) return false
  return true
}

export function loadTasks(dir = tasksDir) {
  let files = []
  try { files = readdirSync(dir).filter(f => f.endsWith('.md')) } catch { /* no tasks yet */ }
  return files.map(f => parseTask(readFileSync(join(dir, f), 'utf8'), f))
}

const isActive = t => t.status !== 'done'

export function findCollisions(tasks) {
  const active = tasks.filter(isActive)
  const out = []
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++)
      for (const a of active[i].paths) for (const b of active[j].paths)
        if (collide(a, b)) out.push({ a: active[i], b: active[j], pa: a, pb: b })
  return out
}

function main() {
  const args = process.argv.slice(2)
  const tasks = loadTasks()
  if (args[0] === '--status') {
    if (!tasks.length) return console.log('No tasks yet. Create team/tasks/<slug>.md from team/TEMPLATE.md.')
    console.log('| task | owner | status | paths |\n|---|---|---|---|')
    for (const t of tasks) console.log(`| ${t.file} | ${t.owner} | ${t.status} | ${t.paths.join(', ')} |`)
    return
  }
  if (args[0] === '--paths') {
    const hits = []
    for (const t of tasks.filter(isActive))
      for (const p of t.paths) for (const q of args.slice(1))
        if (collide(p, q)) hits.push(`${q}  <->  ${p}  (${t.file}, owner ${t.owner}, ${t.status})`)
    if (hits.length) { console.error('COLLISION with active tasks:\n' + hits.join('\n')); process.exit(1) }
    return console.log('No collisions.')
  }
  const hits = findCollisions(tasks)
  if (hits.length) {
    console.error('COLLISIONS between active tasks:')
    for (const h of hits) console.error(`  ${h.a.file} (${h.a.owner}) ${h.pa}  <->  ${h.b.file} (${h.b.owner}) ${h.pb}`)
    process.exit(1)
  }
  console.log(`OK: ${tasks.filter(isActive).length} active task(s), no path collisions.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
