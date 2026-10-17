import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTask, collide, findCollisions } from './check-overlap.mjs'

test('parseTask reads block and inline lists', () => {
  const t = parseTask('---\nowner: ana\nstatus: in-progress\npaths:\n  - src/api/**\n  - "lib/pay.ts"\nshared: [package.json]\n---\n# x', 't.md')
  assert.equal(t.owner, 'ana')
  assert.deepEqual(t.paths, ['src/api/**', 'lib/pay.ts'])
  assert.deepEqual(t.shared, ['package.json'])
})

test('collide: nested, equal, disjoint', () => {
  assert.equal(collide('src/api/**', 'src/api/pay.ts'), true)
  assert.equal(collide('src/**', 'src/ui/a.tsx'), true)
  assert.equal(collide('src/api/**', 'src/ui/**'), false)
  assert.equal(collide('a/b.ts', 'a/c.ts'), false)
})

test('findCollisions ignores done tasks', () => {
  const mk = (owner, status, paths) => ({ file: owner + '.md', owner, status, paths, shared: [] })
  assert.equal(findCollisions([mk('a', 'in-progress', ['src/x/**']), mk('b', 'done', ['src/x/**'])]).length, 0)
  assert.equal(findCollisions([mk('a', 'in-progress', ['src/x/**']), mk('b', 'todo', ['src/x/y.ts'])]).length, 1)
})
