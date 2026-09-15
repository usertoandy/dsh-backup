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

// --- the renderer is registered under the Node kind --------------------------
assert.equal(slotRegistrations.length, 1, 'one keyed Chat Node renderer registered')
assert.equal(slotRegistrations[0].options.name, 'conversation.chat.node')
assert.equal(slotRegistrations[0].options.key, 'backup-command-input',
  'renderer key must equal the Node kind, or the card falls back to a raw JSON dump')

// --- the rendered tree carries the command text ------------------------------
const tree = slotRegistrations[0].component({ node, t: () => '' })
const text = []
const walk = element => {
  if (element === null || element === undefined || typeof element === 'boolean') return
  if (typeof element === 'string' || typeof element === 'number') { text.push(String(element)); return }
  if (Array.isArray(element)) { for (const child of element) walk(child); return }
  for (const child of element.children ?? []) walk(child)
}
walk(tree)
assert.deepEqual(text, ['/backup-list'], 'the bubble renders exactly the typed command line')
assert.equal(tree.props['data-backup-command-input'], '', 'renderer marks its own node for tests/styling')

console.log('ALL CLIENT TESTS PASSED')
