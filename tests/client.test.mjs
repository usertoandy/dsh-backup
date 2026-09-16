// dsh-backup browser-half test, run with plain node: `pnpm test`.
// Materializes src/client.js through a fake `window.__ModuleLoader__` and a
// stub React, then asserts the projection registers a VISIBLE non-`command`
// Chat Node — the property that makes a fresh session render the result card.
// No browser, no React, no network.
import assert from 'assert/strict'

// --- capture the module registration ----------------------------------------
let registration
globalThis.window = {
  __ModuleLoader__: { load: value => { registration = value } },
}

await import('../src/client.js')

assert.ok(registration !== undefined, 'bundle registered through __ModuleLoader__.load')
assert.equal(registration.id, '@wildusk/dsh-backup', 'registration id is the package name')
assert.equal(typeof registration.factory, 'function', 'factory is callable')

// --- stub React: memo is identity, createElement builds a plain tree --------
const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children })
const React = { createElement, memo: component => component }

const exports_ = registration.factory(specifier => {
  assert.equal(specifier, 'react', `bundle requires only the platform seed (got "${specifier}")`)
  return React
})

assert.equal(typeof exports_.apply, 'function', 'exports.apply present')
assert.deepEqual(exports_.inject, ['uiConversation', 'slots'], 'exports.inject names its services')

// --- apply against a stub client context ------------------------------------
const definitions = []
const slotRegistrations = []
exports_.apply({
  uiConversation: { events: { register: definition => { definitions.push(definition); return () => {} } } },
  slots: {
    inject: (_name, callback) => { callback() },
    register: (options, component) => { slotRegistrations.push({ options, component }); return () => {} },
  },
})

assert.equal(definitions.length, 1, 'exactly one Conversation Definition registered')
const definition = definitions[0]
assert.equal(definition.kind, 'backup-command-input')
assert.equal(definition.target, 'chat')
assert.equal(typeof definition.buildViewNode, 'function', 'target and buildViewNode declared together')

// --- match only owns the three backup commands -------------------------------
const run = (name, args) => ({
  type: 'command/run',
  seq: 7,
  time: 1700000000000,
  data: { commandId: `cmd-${name}`, name, ...(args === undefined ? {} : { args }) },
})

for (const name of ['backup', 'backup-list', 'backup-restore']) {
  const match = definition.match(run(name, ''))
  assert.deepEqual(match, { id: `cmd-${name}`, role: 'start' }, `/${name} is owned by this projection`)
}
assert.equal(definition.match(run('goal', '')), null, 'other commands are not claimed')
assert.equal(definition.match({ type: 'command/done', seq: 8, time: 0, data: {} }), null,
  'command/done alone does not start the projection')
assert.equal(definition.match({ type: 'user/message', seq: 9, time: 0, data: {} }), null,
  'unrelated events are ignored')

// --- the materialized Node is visible and NOT kind 'command' -----------------
// This is the load-bearing assertion: the chat view activates on
// `order.some(key => nodes.get(key)?.kind !== 'command')`, so a `command` kind
// here would leave a fresh session on the empty hero.
// The engine, not the Definition, wraps the matched event in a ConversationMatch.
const conversationMatch = (name, args) => ({
  event: run(name, args),
  role: 'start',
  location: { kind: 'unresolved' },
})
const match = conversationMatch('backup-list')
const state = definition.start({ key: 'chat:cmd-backup-list', id: 'cmd-backup-list' }, match)
assert.equal(state.text, '/backup-list', 'bare invocation projects without trailing whitespace')

const context = {
  key: 'chat:cmd-backup-list',
  id: 'cmd-backup-list',
  state,
  start: match,
}
const node = definition.buildViewNode(context)
assert.equal(node.kind, 'backup-command-input')
assert.notEqual(node.kind, 'command', 'a non-command kind is what activates the chat view')
assert.equal(node.visibility, 'visible', 'hidden nodes are filtered out of the ordered list')
assert.equal(node.target, 'chat')
assert.equal(node.key, context.key, 'the engine-owned key must be stable')
assert.equal(node.anchorSeq, 6.9, 'anchored just before the paired result row')
assert.equal(node.data.text, '/backup-list')

// Arguments survive the round trip, trailing parser whitespace does not.
const argued = definition.start({}, conversationMatch('backup-restore', '  extra  '))
assert.equal(argued.text, '/backup-restore  extra', 'arguments preserved, trailing whitespace trimmed')

// --- renderers are registered under the right seats --------------------------
const nodeRegistrations = slotRegistrations.filter(entry => entry.options.name === 'conversation.chat.node')
const commandRegistrations = slotRegistrations.filter(entry => entry.options.name === 'conversation.chat.commandview')
assert.equal(slotRegistrations.length, 4, 'one Node renderer plus three command-view renderers')
assert.equal(nodeRegistrations.length, 1, 'one keyed Chat Node renderer registered')
assert.equal(nodeRegistrations[0].options.key, 'backup-command-input',
  'renderer key must equal the Node kind, or the card falls back to a raw JSON dump')
// The commandview slot is keyed by COMMAND NAME: a key that does not match the
// command leaves the shipped (collapsed) generic card in place.
assert.deepEqual(
  commandRegistrations.map(entry => entry.options.key),
  ['backup', 'backup-list', 'backup-restore'],
  'every owned command gets a command-view renderer keyed by its own name',
)

// --- the rendered tree carries the command text ------------------------------
const walk = (element, into) => {
  if (element === null || element === undefined || typeof element === 'boolean') return
  if (typeof element === 'string' || typeof element === 'number') { into.push(String(element)); return }
  if (Array.isArray(element)) { for (const child of element) walk(child, into); return }
  for (const child of element.children ?? []) walk(child, into)
}
const text = []
const tree = nodeRegistrations[0].component({ node })
walk(tree, text)
assert.deepEqual(text, ['/backup-list'], 'the bubble renders exactly the typed command line')
assert.equal(tree.props['data-backup-command-input'], '', 'renderer marks its own node for tests/styling')

// --- the result card shows its body WITHOUT an expand interaction ------------
// Load-bearing: the shipped GenericCommandCard renders the outcome into a
// single nowrap/ellipsised `.summary` and only reveals the full text behind a
// disclosure chevron. The override must render the whole text on first paint.
const cardFor = name => commandRegistrations.find(entry => entry.options.key === name).component
const folded = (name, outcome) => ({
  kind: 'command',
  seq: 8,
  time: 1700000000000,
  commandId: `cmd-${name}`,
  name,
  args: null,
  outcome,
})
const TABLE = [
  'Existing backups in /tmp/backups: 2',
  '',
  '  #  Filename                                    Size       Date',
  '  ── ─────────────────────────────────────────── ────────── ────────────────────',
  '   1 dsh-backup-2026-01-01_00-00-00.tar.gz        1.2 MB  2026-01-01 00:00:00',
  '   2 dsh-backup-2026-01-02_00-00-00.tar.gz        1.3 MB  2026-01-02 00:00:00',
].join('\n')

const okTree = cardFor('backup-list')({ node: folded('backup-list', { kind: 'success', text: TABLE }) })
assert.equal(okTree.props['data-state'], 'ok')
assert.equal(okTree.props['data-backup-command'], 'backup-list', 'the card names its command')
const body = okTree.children.find(child => child !== null && child.type === 'pre')
assert.ok(body !== undefined, 'a <pre> body is present on the first render (nothing to click)')
assert.equal(body.props.className, 'dbk-cmd-body')
assert.equal(body.children[0], TABLE, 'the whole multi-line outcome is rendered, unclipped')
const okText = []
walk(okTree, okText)
assert.ok(okText.includes('/backup-list'), 'the command line heads the row')
assert.ok(okText.includes(TABLE), 'no collapsed summary stands in for the table')

// A rejection message (the /backup-restore decline path) renders the same way.
const rejectTree = cardFor('backup-restore')({
  node: folded('backup-restore', {
    kind: 'success',
    text: 'Restore rejected — you chose "no". Nothing was changed.',
  }),
})
assert.equal(rejectTree.props['data-state'], 'ok', 'a rejection is a normal outcome, not an error')
assert.ok(rejectTree.children.some(child => child !== null && child.type === 'pre'),
  'the rejection message is visible without expanding')

// Unsettled and failed outcomes keep their state, and never render a body.
const runningTree = cardFor('backup')({ node: folded('backup', null) })
assert.equal(runningTree.props['data-state'], 'running')
assert.equal(runningTree.children.some(child => child !== null && child.type === 'pre'), false,
  'no body before the command settles')
const errorTree = cardFor('backup')({ node: folded('backup', { kind: 'error', text: 'Boom' }) })
assert.equal(errorTree.props['data-state'], 'error')
assert.equal(errorTree.children.find(child => child !== null && child.type === 'pre').children[0], 'Boom')

console.log('ALL CLIENT TESTS PASSED')
