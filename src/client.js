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
 * session.
 *
 * It also replaces the shipped result card for those three commands. The
 * generic `GenericCommandCard` folds the outcome into one `nowrap`,
 * ellipsised line and only reveals the full text after a click on the
 * disclosure chevron — right for a one-line status, wrong for `/backup-list`'s
 * table, which is unreadable until expanded. The override below
 * (`conversation.chat.commandview`, keyed by command name) keeps the command
 * name and state dot and then always renders the outcome text, so nothing has
 * to be clicked. Very long output stays bounded by an internal scroll area.
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
    const CSS_ID = '@wildusk/dsh-backup/client'
    /** Attribute marking this plugin's own stylesheet. */
    const CSS_PLUGIN = '@wildusk/dsh-backup'

    /**
     * Copy the user bubble's geometry and semantic tokens (mirrors
     * ui-goal's GoalCommandInputView) without pulling in the design system.
     * The command-card rules reuse the same tokens as the shipped
     * GenericCommandCard, so both themes follow automatically.
     */
    const CSS = [
      // -- command echo bubble (activates the chat view in a fresh session) --
      '.dbk-row{display:flex;flex-direction:column;align-items:flex-end;gap:6px}',
      '.dbk-stack{display:flex;flex-direction:column;align-items:flex-end;min-width:0;',
      'max-width:min(calc(var(--dsh-chat-content-width,748px) * 0.702),82%)}',
      '.dbk-bubble{max-width:100%;padding:10px 16px;overflow-wrap:anywhere;border-radius:22px;',
      'background:var(--dsw-specific-bubble);color:var(--dsw-alias-label-primary);',
      'font:var(--dsw-font-markdown-code);font-size:var(--dsh-content-font-size,14px);',
      'line-height:calc(22px + var(--dsh-content-font-delta,0px));white-space:pre-wrap}',
      // -- always-expanded result card (replaces GenericCommandCard) --------
      '.dbk-cmd{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.dbk-cmd-head{display:flex;align-items:center;gap:8px;min-width:0}',
      '.dbk-cmd-dot{flex:none;width:6px;height:6px;border-radius:50%;',
      'background:var(--dsw-alias-state-success-primary)}',
      '.dbk-cmd[data-state="running"] .dbk-cmd-dot{background:var(--dsw-alias-label-caption)}',
      '.dbk-cmd[data-state="error"] .dbk-cmd-dot{background:var(--dsw-alias-state-error-primary)}',
      '.dbk-cmd-title{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;',
      'white-space:nowrap;color:var(--dsw-alias-label-secondary);',
      'font-size:var(--dsh-content-font-size-secondary,13px);',
      'line-height:calc(24px + var(--dsh-content-font-delta,0px))}',
      '.dbk-cmd-note{flex:none;color:var(--dsw-alias-label-tertiary);',
      'font-size:var(--dsh-content-font-size-secondary,13px)}',
      '.dbk-cmd-body{max-height:min(60vh,420px);margin:0;padding:12px 16px;overflow:auto;',
      'border:0.5px solid var(--dsw-alias-border-l1);border-radius:12px;',
      'background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-primary);',
      'font:var(--dsw-font-markdown-code);white-space:pre-wrap}',
      '.dbk-cmd[data-state="error"] .dbk-cmd-body{color:var(--dsw-alias-state-error-primary)}',
    ].join('')

    /**
     * Install this plugin's stylesheet. Any tag a previous materialization of
     * this plugin left behind is dropped first, so a hot reload never renders
     * against stale rules.
     */
    function injectCss() {
      if (typeof document === 'undefined') return
      const stale = document.querySelectorAll('style[data-plugin="' + CSS_PLUGIN + '"]')
      for (let index = 0; index < stale.length; index += 1) stale[index].remove()
      const tag = document.createElement('style')
      tag.id = CSS_ID
      tag.dataset.plugin = CSS_PLUGIN
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

    /**
     * The durable command line of a folded command Node, e.g. `/backup-list`.
     * @param node - folded command lifecycle.
     * @returns the line as the user typed it.
     */
    function commandLine(node) {
      return '/' + (node.name ?? '') + (node.args ?? '').trimEnd()
    }

    /**
     * Fold state → row state. An unsettled outcome is still running.
     * @param outcome - the command Node's outcome, or null while unsettled.
     * @returns `running`, `ok`, or `error`.
     */
    function stateOf(outcome) {
      if (outcome === null || outcome === undefined) return 'running'
      return outcome.kind === 'error' ? 'error' : 'ok'
    }

    /**
     * Always-expanded result card. Replaces the shipped `GenericCommandCard`
     * for `/backup`, `/backup-list` and `/backup-restore`: the outcome text is
     * rendered directly instead of behind a disclosure chevron, so the result
     * is readable without a click.
     */
    const BackupCommandCardView = memo(function BackupCommandCardView({ node }) {
      const state = stateOf(node.outcome)
      const text = node.outcome === null || node.outcome === undefined
        ? null
        : node.outcome.text ?? null
      const body = text === null || text === '' ? null : text
      return h(
        'div',
        {
          className: 'dbk-cmd',
          'data-state': state,
          'data-backup-command': node.name ?? '',
        },
        h(
          'div',
          { className: 'dbk-cmd-head' },
          h('span', { className: 'dbk-cmd-dot', 'aria-hidden': 'true' }),
          h('span', { className: 'dbk-cmd-title' }, commandLine(node)),
          body === null && state === 'running'
            ? h('span', { className: 'dbk-cmd-note' }, 'running…')
            : null,
        ),
        body === null ? null : h('pre', { className: 'dbk-cmd-body' }, body),
      )
    })

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
      // `conversation.chat.commandview` is declared as a child of the `command`
      // Chat Node entry, so this registration waits for that declaration; the
      // key is the command name. An unoccupied key falls back to the generic
      // card, which is why every command we own is registered explicitly.
      for (const command of COMMANDS) {
        slots.inject('conversation.chat.commandview', () => slots.register({
          name: 'conversation.chat.commandview',
          key: command,
        }, BackupCommandCardView))
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
