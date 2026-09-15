/**
 * @wildusk/dsh-backup — browser half (single-file bundle, loaded through
 * `window.__ModuleLoader__`).
 *
 * Why this exists: the harness transcript deliberately stays on the empty
 * hero while a session is blank, and a generic `command` Chat Node does not
 * count as conversation content (see the chat view's `isActive` predicate and
 * `conversationPhase`). So in a brand-new session a `/backup-list` result row
 * was logged durably but never rendered until a later model turn added a
 * non-command node.
 *
 * The Goal command solved the identical problem with a command-owned
 * Conversation Definition that emits an extra *visible* node of its own kind.
 * This file does the same: for `/backup`, `/backup-list` and `/backup-restore`
 * it projects the typed command line as a right-aligned input bubble anchored
 * just before the durable result row. That non-`command` node activates the
 * chat view, so the existing result card renders immediately in a fresh
 * session. The generic command lifecycle and its result row are untouched.
 *
 * No build step: this file is served to the browser verbatim, so it is written
 * as plain browser JS (the factory closure keeps every declaration off the
 * shared script scope, which the host concatenates with other plugin bundles).
 */

window.__ModuleLoader__.load({
  id: '@wildusk/dsh-backup',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createElement: h, memo } = React

    /** Command names this projection owns. */
    const COMMANDS = ['backup', 'backup-list', 'backup-restore']
    /** Chat Node kind owned by this plugin. */
    const NODE_KIND = 'backup-command-input'
    /** Style element id, so re-materialization never double-injects. */
    const CSS_ID = '@wildusk/dsh-backup/command-input'

    /**
     * Copy the user bubble's geometry and semantic tokens (mirrors
     * ui-goal's GoalCommandInputView) without pulling in the design system.
     */
    const CSS = [
      '.dbk-row{display:flex;flex-direction:column;align-items:flex-end;gap:6px}',
      '.dbk-stack{display:flex;flex-direction:column;align-items:flex-end;min-width:0;',
      'max-width:min(calc(var(--dsh-chat-content-width,748px) * 0.702),82%)}',
      '.dbk-bubble{max-width:100%;padding:10px 16px;overflow-wrap:anywhere;border-radius:22px;',
      'background:var(--dsw-specific-bubble);color:var(--dsw-alias-label-primary);',
      'font:var(--dsw-font-markdown-code);font-size:var(--dsh-content-font-size,14px);',
      'line-height:calc(22px + var(--dsh-content-font-delta,0px));white-space:pre-wrap}',
    ].join('')

    /** Inject this plugin's stylesheet once. */
    function injectCss() {
      if (typeof document === 'undefined') return
      if (document.getElementById(CSS_ID) !== null) return
      const tag = document.createElement('style')
      tag.id = CSS_ID
      tag.dataset.plugin = '@wildusk/dsh-backup'
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /**
     * Derive the visible command line from the structured durable run.
     * @param event - `/backup*` command run.
     * @returns the typed line with trailing parser whitespace removed.
     */
    function commandText(event) {
      return '/' + event.data.name + (event.data.args ?? '').trimEnd()
    }

    /** Right-aligned command echo bubble; no message actions, no timestamp. */
    const BackupCommandInputView = memo(function BackupCommandInputView({ node }) {
      const data = node.data
      return h(
        'div',
        {
          className: 'dbk-row',
          'data-backup-command-input': '',
          role: 'group',
          'aria-label': 'Command input',
        },
        h(
          'div',
          { className: 'dbk-stack' },
          h('div', { className: 'dbk-bubble' }, data.text),
        ),
      )
    })

    /**
     * Backup-owned command input projection. It runs beside the generic
     * `command` Definition, which keeps the durable result row.
     */
    const backupCommandInputDefinition = {
      kind: NODE_KIND,
      target: 'chat',
      match: event => event.type === 'command/run' && COMMANDS.indexOf(event.data.name) !== -1
        ? { id: String(event.data.commandId), role: 'start' }
        : null,
      start: (_context, match) => ({
        commandId: match.event.data.commandId,
        seq: match.event.seq,
        time: match.event.time,
        text: commandText(match.event),
      }),
      update: context => context.state,
      buildViewNode: (context) => {
        if (context.state === undefined) return null
        return {
          key: context.key,
          kind: NODE_KIND,
          id: context.id,
          target: 'chat',
          // Just before the paired result row, matching the Goal projection.
          anchorSeq: context.state.seq - 0.1,
          location: context.start?.location ?? { kind: 'unresolved' },
          visibility: 'visible',
          data: {
            commandId: context.state.commandId,
            text: context.state.text,
            time: context.state.time,
          },
        }
      },
    }

    /** Required services: the Conversation registry and the keyed Node seat. */
    const inject = ['uiConversation', 'slots']

    /**
     * Client plugin body.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      injectCss()
      const conversation = ctx.uiConversation
      const slots = ctx.slots
      if (conversation === undefined || slots === undefined) return
      conversation.events.register(backupCommandInputDefinition)
      slots.inject('conversation.chat.node', () => slots.register({
        name: 'conversation.chat.node',
        key: NODE_KIND,
      }, BackupCommandInputView))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
