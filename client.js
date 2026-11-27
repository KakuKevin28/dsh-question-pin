/**
 * Question Pin — keeps the question you asked floating beside its answer.
 *
 * How it works:
 *
 * - It contributes one session-scoped entry to `conversation.input.overlay`,
 *   which the shipped composer renders inside the composer card. That entry is
 *   only a locator: a zero-size marker used to reach the surrounding
 *   `[data-conversation-session]` scope.
 * - The visible surface itself is portalled to `document.body`, so it is
 *   screen-fixed: it never takes box in the message flow and never scrolls.
 * - The active Turn is resolved from shipped row annotations only
 *   (`[data-chat-anchor-key]`, `[data-chat-turn]`) measured against the
 *   scrollport's top edge. No shipped class name is read.
 * - The question text is read from that Turn's own user row, so the card shows
 *   the whole question instead of the 50-character navigation preview.
 * - Attachments are read from the same row: an image becomes a thumbnail and a
 *   file becomes its name, because the row's own text also carries the
 *   attachment chrome (file type, byte size) that no one wants in the card.
 */
window.__ModuleLoader__.load({
  id: 'dsh-question-pin',
  factory(require) {
    const React = require('react')
    const { useCallback, useEffect, useRef, useState } = React
    const h = React.createElement

    let createPortal = null
    try {
      createPortal = require('react-dom').createPortal
    } catch (error) {
      createPortal = null
    }

    const NAMESPACE = 'dsh-question-pin'
    const SCOPE_SELECTOR = '[data-conversation-session]'
    const SCROLLER_SELECTOR = '[data-conversation-scroll]'
    const ROW_SELECTOR = '[data-chat-anchor-key]'
    const FLOW_SELECTOR = '[data-chat-flow]'
    /** DSH's per-message action row: copy/branch buttons plus the message clock. */
    const CHROME_SELECTOR = '[data-clock]'
    /** The user row's attachment strip: image tiles and file cards live here. */
    const ATTACHMENT_SELECTOR = '[data-message-attachments]'
    /** The user row's text bubble — the only text container that is user-only. */
    const BUBBLE_SELECTOR = '[data-message-bubble],[data-text-interaction-source]'
    /** User-only markers, used to reject rows that hold no question at all. */
    const USER_ROW_SELECTOR = '[data-message-bubble],[data-message-attachments]'
    /** An image tile is a button before its pixels arrive, so match both states. */
    const IMAGE_TILE_SELECTOR = 'button[data-variant],img'
    const MAX_ATTACHMENTS = 3
    const NO_ITEMS = Object.freeze([])
    const NO_ATTACHMENTS = Object.freeze([])

    const ZH = {
      label: '问题钉',
      title: '你的问题',
      jump: '回到这个问题',
      copy: '复制问题',
      copied: '已复制',
      collapse: '收起成小钉',
      expand: '展开问题',
      image: '图片',
      more: '另有 {n} 个附件未显示',
    }

    const EN = {
      label: 'Question Pin',
      title: 'Your question',
      jump: 'Back to this question',
      copy: 'Copy question',
      copied: 'Copied',
      collapse: 'Collapse to a pin',
      expand: 'Show the question',
      image: 'Image',
      more: '{n} more attachments not shown',
    }

    const CSS = `
.dsh-qp-surface {
  position: fixed;
  z-index: 8;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-overlay);
  border: 0;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-panel);
  box-shadow: var(--dsw-elevation-panel);
  font-family: inherit;
  animation: dsh-qp-enter 160ms ease-out both;
}
.dsh-qp-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: calc(100vh - 24px);
}
.dsh-qp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 6px 5px 10px;
}
.dsh-qp-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 100px;
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-qp-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.dsh-qp-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
}
.dsh-qp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
@media (hover: hover) {
  .dsh-qp-btn:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
}
.dsh-qp-btn:active {
  background: var(--dsw-alias-interactive-bg-hover-solid, var(--dsw-alias-bg-layer-2));
}
.dsh-qp-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
  border-radius: 6px;
}
.dsh-qp-btn[data-copied] {
  color: var(--dsw-alias-state-success-primary);
}
.dsh-qp-text {
  --dsh-qp-line: calc(22px + var(--dsh-content-font-delta, 0px));
  /* Allow the card's max-height to shrink the text area rather than overflowing. */
  min-height: 0;
  margin: 0;
  padding: 0 12px 12px;
  /* Three lines by default; anything longer scrolls inside the card. */
  max-height: calc(var(--dsh-qp-line) * 3);
  overflow-y: auto;
  overscroll-behavior: contain;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: var(--dsh-qp-line);
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-border-l3) transparent;
}
.dsh-qp-text::-webkit-scrollbar {
  width: 6px;
}
.dsh-qp-text::-webkit-scrollbar-track {
  background: transparent;
}
.dsh-qp-text::-webkit-scrollbar-thumb {
  border-radius: 100px;
  background: var(--dsw-alias-border-l3);
}
.dsh-qp-text:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
.dsh-qp-attach {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 12px 10px;
}
.dsh-qp-thumb {
  display: block;
  flex: none;
  box-sizing: border-box;
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-layer-2);
}
/* One image keeps the full band; multiple attachments stay in a compact row. */
.dsh-qp-thumb:only-child {
  width: 100%;
  height: auto;
  min-height: 48px;
  max-height: 96px;
}
.dsh-qp-file {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-qp-file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-qp-file-icon {
  flex: none;
  display: inline-flex;
}
.dsh-qp-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.dsh-qp-pin {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l3);
  border-radius: 100px;
  corner-shape: round;
  font: inherit;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-button-floating-fill);
  box-shadow: var(--dsw-elevation-panel);
  cursor: pointer;
  transition: background 120ms ease;
}
@media (hover: hover) {
  .dsh-qp-pin:hover {
    background: var(--dsw-alias-button-floating-hover);
  }
}
.dsh-qp-pin:active {
  background: var(--dsw-alias-button-floating-hover);
}
.dsh-qp-pin:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
  border-radius: 100px;
}
.dsh-qp-pin-index {
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
@keyframes dsh-qp-enter {
  from { opacity: 0; transform: translateY(6px) scale(0.97); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-qp-surface { animation: none; }
}
`

    function icon(children) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        children,
      )
    }

    const PIN_ICON = icon([
      h('path', { key: 'bar', d: 'M6 2.5h4' }),
      h('path', { key: 'stem', d: 'M8 2.5v4' }),
      h('path', { key: 'head', d: 'M8 6.5 5.9 8.9a.9.9 0 0 0-.2.6v.5h4.6v-.5a.9.9 0 0 0-.2-.6L8 6.5' }),
      h('path', { key: 'tip', d: 'M8 10.5V14' }),
    ])

    const JUMP_ICON = icon([
      h('path', { key: 'arrow', d: 'M6.5 3.5 3 7l3.5 3.5' }),
      h('path', { key: 'line', d: 'M3.5 7h6a3 3 0 0 1 3 3v2.5' }),
    ])

    const COPY_ICON = icon([
      h('rect', { key: 'back', x: 5.5, y: 5.5, width: 7, height: 8, rx: 1.5 }),
      h('path', {
        key: 'front',
        d: 'M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v6A1.5 1.5 0 0 0 4 11.5h1.5',
      }),
    ])

    const CHECK_ICON = icon([h('path', { key: 'check', d: 'm3.5 8.5 3 2.5 6-6.5' })])

    const FILE_ICON = icon([
      h('path', { key: 'sheet', d: 'M9.5 2.5H5A1.5 1.5 0 0 0 3.5 4v8A1.5 1.5 0 0 0 5 13.5h6a1.5 1.5 0 0 0 1.5-1.5V5.5z' }),
      h('path', { key: 'fold', d: 'M9.5 2.5v3h3' }),
    ])

    const IMAGE_ICON = icon([
      h('rect', { key: 'frame', x: 2.5, y: 3.5, width: 11, height: 9, rx: 1.5 }),
      h('circle', { key: 'dot', cx: 6, cy: 6.6, r: 0.9 }),
      h('path', { key: 'hill', d: 'M3 11.5 6.6 8.4a1 1 0 0 1 1.3 0l2.2 1.9' }),
    ])

    const CHEVRON_UP_ICON = icon([h('path', { key: 'up', d: 'M4 9.5 8 5.5l4 4' })])

    const CHEVRON_DOWN_ICON = icon([h('path', { key: 'down', d: 'M4 6.5 8 10.5l4-4' })])

    /** Collapse whitespace-only lines while keeping the question's own line breaks. */
    function normalize(raw) {
      const kept = []
      for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
        const trimmed = line.trim()
        if (trimmed === '' && (kept.length === 0 || kept[kept.length - 1] === '')) continue
        kept.push(trimmed)
      }
      while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop()
      return kept.join('\n')
    }

    function findRow(root, key) {
      for (const row of root.querySelectorAll(ROW_SELECTOR)) {
        if (row.dataset.chatAnchorKey === key) return row
      }
      return null
    }

    /**
     * The row's attachments, in the order the user attached them. An image
     * contributes its loaded URL — its tile has no file name to show — and a
     * file card contributes only its name: the second line of the card is the
     * extension and byte size, which the card has no use for.
     */
    function readAttachments(row) {
      const holder = row.querySelector(ATTACHMENT_SELECTOR)
      if (holder === null) return NO_ATTACHMENTS
      const found = []
      for (const child of holder.children) {
        const tile = child.matches(IMAGE_TILE_SELECTOR)
          ? child
          : child.querySelector(IMAGE_TILE_SELECTOR)
        if (tile !== null) {
          const image = tile.matches('img') ? tile : tile.querySelector('img')
          const src = image === null ? '' : String(image.currentSrc || image.getAttribute('src') || '')
          found.push({ kind: 'image', label: '', src })
          continue
        }
        // The image tile's own label is an action ("open ..."), so only a
        // non-image child may name itself through `title`.
        const name = (child.getAttribute('title') ?? '').trim() || normalize(child.textContent ?? '').split('\n')[0]
        if (name !== '') found.push({ kind: 'file', label: name, src: '' })
      }
      return found
    }

    /** The whole question, not the navigation preview. */
    function readQuestion(row, fallback) {
      const attachments = readAttachments(row)
      // The bubble holds the question and nothing else: the attachment strip,
      // the copy/branch chrome and its clock are siblings, not children.
      const bubble = row.querySelector(BUBBLE_SELECTOR)
      let raw = ''
      if (bubble !== null) {
        raw = typeof bubble.innerText === 'string' ? bubble.innerText : String(bubble.textContent ?? '')
      } else if (attachments.length === 0) {
        // No bubble (e.g. an image-only question): the row itself is the only
        // source left. The user row ends with DSH's own chrome: a copy/branch
        // action row whose clock span renders the message time (e.g. `11:44`).
        // `innerText` reads the live tree so it keeps real line breaks and
        // drops CSS-hidden text, then the chrome's own label is subtracted by
        // value — its position sits at the end of the row, so the last
        // occurrence is the one to remove.
        const chrome = row.querySelector(CHROME_SELECTOR)
        const stamp = chrome === null
          ? ''
          : String(chrome.innerText ?? chrome.textContent ?? '').trim()
        raw = typeof row.innerText === 'string' ? row.innerText : String(row.textContent ?? '')
        let trimmed = false
        if (stamp !== '') {
          const index = raw.lastIndexOf(stamp)
          if (index >= 0) {
            raw = `${raw.slice(0, index)}${raw.slice(index + stamp.length)}`
            trimmed = true
          }
        }
        // The chrome label did not appear verbatim: still drop a trailing
        // standalone clock so an unexpected layout cannot leak the time.
        if (!trimmed) raw = raw.replace(/\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/, '')
      }
      // A row with attachments and no bubble asks its question through the
      // attachments alone; its remaining text is only the strip's own chrome
      // (file size, "loading"), which must not be shown as the question.
      let text = normalize(raw)
      // The preview exists to fill in what the row cannot show; once the row
      // shows its own attachments, a 50-character preview would be a downgrade.
      if (text.length < 2 && attachments.length === 0) text = fallback
      return { text: text.length >= 2 ? text : '', attachments }
    }

    /**
     * Resolve the Turn whose question has scrolled past the reading line, plus
     * where the card should sit beside that Turn's answer column.
     */
    function readView(scroller, scope, items) {
      if (items.length === 0) return null
      const scrollBox = scroller.getBoundingClientRect()
      if (scrollBox.height < 120 || scrollBox.width < 160) return null
      const flow = scope.querySelector(FLOW_SELECTOR)
      if (flow === null) return null
      const flowBox = flow.getBoundingClientRect()
      if (flowBox.width < 80) return null

      const readingLine = scrollBox.top + 6

      // The Turn the reader is looking at is the one owning the topmost row
      // still crossing the reading line. Every shipped row carries
      // `data-chat-turn`, so this reads the answer actually on screen instead
      // of guessing from a Turn's own question row (which lags one Turn behind
      // whenever that question is tall or the Turn opens with another node).
      let topTurn = null
      for (const row of scroller.querySelectorAll(ROW_SELECTOR)) {
        if (row.closest('[hidden]') !== null) continue
        const box = row.getBoundingClientRect()
        if (box.height < 2) continue
        if (box.bottom <= readingLine) continue
        const turn = Number(row.dataset.chatTurn)
        if (!Number.isSafeInteger(turn)) continue
        topTurn = turn
        break
      }

      const total = items.length

      // Preferred: the Turn owning that top row. A row whose Turn is outside
      // the loaded window, or that carries no Turn at all, must not silence
      // the card, so the previous question-row scan stays as the fallback.
      // Every item is a candidate, including Turns whose prompt preview is
      // empty because the question was nothing but an image or a file.
      let active = topTurn === null ? null : items.find(item => item.turn === topTurn) ?? null
      if (active === null) {
        for (const item of items) {
          const row = findRow(scroller, item.anchorKey)
          if (row === null) continue
          // A row without these markers belongs to an answer or a status node,
          // never to a question, so it must not be floated as one.
          if (row.querySelector(USER_ROW_SELECTOR) === null) continue
          const box = row.getBoundingClientRect()
          if (box.height < 2 || box.bottom > readingLine) continue
          active = item
        }
      }
      if (active === null) return null
      const ordinal = items.indexOf(active) + 1

      // The whole question is on screen under the reading line: nothing to float.
      const questionRow = findRow(scroller, active.anchorKey)
      if (questionRow === null) return null
      // A Turn can open without a user node at all; its anchor row is then an
      // answer row, and floating it would show the answer as the question.
      if (questionRow.querySelector(USER_ROW_SELECTOR) === null) return null
      const questionBox = questionRow.getBoundingClientRect()
      if (questionBox.height >= 2 && questionBox.top >= readingLine) return null

      const preview = typeof active.prompt === 'string' ? active.prompt.trim() : ''
      const question = readQuestion(questionRow, preview)
      if (question.text === '' && question.attachments.length === 0) return null

      const viewWidth = window.innerWidth
      const viewHeight = window.innerHeight
      const gap = 16
      const minWidth = 236
      const maxWidth = 320
      const room = viewWidth - flowBox.right - gap - 12
      const beside = room >= minWidth
      const width = beside
        ? Math.round(Math.min(maxWidth, room))
        : Math.round(Math.min(288, Math.max(200, viewWidth - 32)))
      const left = beside ? Math.round(flowBox.right + gap) : Math.round(viewWidth - width - 16)
      const top = Math.max(8, Math.min(
        Math.round(scrollBox.top + 10),
        Math.round(viewHeight * 0.5),
        // Reserve room for the floor height below, so a short viewport pulls
        // the card up instead of letting it run off the bottom edge.
        viewHeight - 172,
      ))
      // Aim for 160px, but never past the bottom edge: the floor gives way when
      // the space below is shorter, so the card always fits the viewport.
      const roomBelow = viewHeight - top
      const maxHeight = Math.min(Math.max(160, roomBelow - 12), roomBelow)
      return {
        key: active.anchorKey,
        ordinal,
        total,
        text: question.text,
        attachments: question.attachments,
        left,
        top,
        maxHeight,
        width,
      }
    }

    function sameAttachments(current, next) {
      if (current === next) return true
      if (current.length !== next.length) return false
      for (let index = 0; index < current.length; index += 1) {
        const a = current[index]
        const b = next[index]
        if (a.kind !== b.kind || a.label !== b.label || a.src !== b.src) return false
      }
      return true
    }

    function sameView(current, next) {
      if (current === null || next === null) return current === next
      return current.key === next.key
        && current.ordinal === next.ordinal
        && current.total === next.total
        && current.text === next.text
        && sameAttachments(current.attachments, next.attachments)
        && current.left === next.left
        && current.top === next.top
        && current.maxHeight === next.maxHeight
        && current.width === next.width
    }

    function QuestionPin(props) {
      const items = props.useChat(snapshot => snapshot?.navigation?.items?.() ?? NO_ITEMS)
      const translation = props.t
      const translate = typeof translation === 'function'
        ? translation
        : key => ZH[key] ?? key

      const markerRef = useRef(null)
      const rootRef = useRef(null)
      const textRef = useRef(null)
      const scrollerRef = useRef(null)
      const copyTimerRef = useRef(0)
      const [view, setView] = useState(null)
      const [collapsedKey, setCollapsedKey] = useState(null)
      const [copiedKey, setCopiedKey] = useState(null)

      const measure = useCallback(() => {
        const marker = markerRef.current
        if (marker === null) return
        const scope = marker.closest(SCOPE_SELECTOR)
        if (scope === null) {
          scrollerRef.current = null
          setView(null)
          return
        }
        const scroller = scope.querySelector(SCROLLER_SELECTOR) ?? scope
        scrollerRef.current = scroller
        const next = readView(scroller, scope, items)
        setView(current => sameView(current, next) ? current : next)
      }, [items])

      useEffect(() => {
        let frame = 0
        const schedule = () => {
          if (frame !== 0) return
          frame = requestAnimationFrame(() => {
            frame = 0
            measure()
          })
        }
        measure()
        const marker = markerRef.current
        const scope = marker === null ? null : marker.closest(SCOPE_SELECTOR)
        const scroller = scope === null ? null : scope.querySelector(SCROLLER_SELECTOR) ?? scope
        scroller?.addEventListener('scroll', schedule, { passive: true })
        window.addEventListener('resize', schedule)
        window.addEventListener('scroll', schedule, true)
        let sizes = null
        if (typeof ResizeObserver === 'function' && scope !== null) {
          sizes = new ResizeObserver(schedule)
          sizes.observe(scope)
          if (scroller !== null && scroller !== scope) sizes.observe(scroller)
        }
        let rows = null
        if (typeof MutationObserver === 'function' && scroller !== null) {
          // Rows can mount or unmount without `items` changing identity.
          rows = new MutationObserver(schedule)
          rows.observe(scroller, { childList: true, subtree: true })
        }
        return () => {
          if (frame !== 0) cancelAnimationFrame(frame)
          scroller?.removeEventListener('scroll', schedule)
          window.removeEventListener('resize', schedule)
          window.removeEventListener('scroll', schedule, true)
          sizes?.disconnect()
          rows?.disconnect()
        }
      }, [measure])

      const visible = view !== null
      const collapsed = visible && collapsedKey === view.key

      // The card sits outside the scrollport, so a plain wheel over it must be
      // handed back to the chat. Ctrl/Cmd+wheel is browser zoom, not reading,
      // so it must pass through untouched.
      useEffect(() => {
        const node = rootRef.current
        if (node === null || !visible) return undefined
        const onWheel = event => {
          if (event.ctrlKey || event.metaKey) return
          const scroller = scrollerRef.current
          if (scroller === null) return
          const area = textRef.current
          if (area !== null && area.contains(event.target)) {
            // Let the text area scroll itself until it is genuinely at the edge
            // in the direction of travel; only then does the chat take over.
            // Testing scrollTop instead of scrollTop + deltaY keeps a short
            // overflow reachable when one wheel step jumps past the limit.
            const limit = area.scrollHeight - area.clientHeight
            if (limit > 1) {
              if (event.deltaY > 0 && area.scrollTop < limit - 1) return
              if (event.deltaY < 0 && area.scrollTop > 1) return
            }
          }
          const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1
          scroller.scrollBy({ top: event.deltaY * unit, behavior: 'auto' })
          event.preventDefault()
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => node.removeEventListener('wheel', onWheel)
      }, [visible, collapsed])

      useEffect(() => () => { window.clearTimeout(copyTimerRef.current) }, [])

      const jump = useCallback(() => {
        const scroller = scrollerRef.current
        if (scroller === null || view === null) return
        const row = findRow(scroller, view.key)
        if (row === null) return
        row.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      }, [view])

      const copy = useCallback(() => {
        if (view === null) return
        // A question that is nothing but attachments has no text; its file
        // names are the only part of it that can meaningfully be pasted.
        const text = view.text !== ''
          ? view.text
          : view.attachments.filter(item => item.kind === 'file').map(item => item.label).join('\n')
        if (text === '') return
        const key = view.key
        const clipboard = navigator.clipboard
        if (clipboard === undefined || typeof clipboard.writeText !== 'function') return
        clipboard.writeText(text).then(() => {
          setCopiedKey(key)
          window.clearTimeout(copyTimerRef.current)
          copyTimerRef.current = window.setTimeout(() => setCopiedKey(null), 1600)
        }, () => {})
      }, [view])

      const marker = h('span', {
        ref: markerRef,
        'data-question-pin-anchor': '',
        'aria-hidden': 'true',
        style: { display: 'none' },
      })

      if (view === null) return marker

      const copied = copiedKey === view.key
      const position = { left: view.left + 'px', top: view.top + 'px' }

      const action = (label, onClick, children, extra) => h('button', {
        type: 'button',
        className: 'dsh-qp-btn',
        title: label,
        'aria-label': label,
        onClick,
        ...extra,
      }, children)

      // One image keeps its whole width so it stays legible; files and any
      // overflow collapse into pills on the same row.
      const attachmentPill = (label, key, iconNode) => h('span', { key, className: 'dsh-qp-file', title: label },
        h('span', { className: 'dsh-qp-file-icon' }, iconNode),
        h('span', { className: 'dsh-qp-file-name' }, label))

      const attachmentNode = (item, index) => {
        if (item.kind !== 'image') return attachmentPill(item.label, `a${index}`, FILE_ICON)
        // The tile exists before the pixels load, so an empty source is the
        // loading state rather than an error.
        if (item.src === '') return attachmentPill(translate('image'), `a${index}`, IMAGE_ICON)
        return h('img', {
          key: `a${index}`,
          className: 'dsh-qp-thumb',
          src: item.src,
          alt: translate('image'),
          loading: 'lazy',
          draggable: false,
        })
      }

      const shown = view.attachments.slice(0, MAX_ATTACHMENTS)
      const hiddenCount = view.attachments.length - shown.length
      const hiddenLabel = hiddenCount > 0
        ? String(translate('more')).replace('{n}', String(hiddenCount))
        : ''
      const attach = shown.length === 0 ? null : h('div', { className: 'dsh-qp-attach' },
        shown.map(attachmentNode),
        hiddenCount > 0
          ? h('span', { key: 'more', className: 'dsh-qp-file' },
            // The tooltip lives on the hidden counter so the visible text and the
            // screen-reader sentence below are never announced together.
            h('span', { 'aria-hidden': 'true', title: hiddenLabel }, `+${hiddenCount}`),
            // The visible "+N" says nothing to a screen reader, and a bare span
            // has no role to hang a name on, so carry the sentence in real text.
            h('span', { className: 'dsh-qp-sr' }, hiddenLabel))
          : null)

      const surface = collapsed
        ? h('button', {
          type: 'button',
          className: 'dsh-qp-pin dsh-qp-surface',
          style: position,
          title: translate('expand'),
          'aria-label': translate('expand'),
          onClick: () => setCollapsedKey(null),
        }, PIN_ICON, h('span', { className: 'dsh-qp-pin-index' }, String(view.ordinal)))
        : h('aside', {
          className: 'dsh-qp-card dsh-qp-surface',
          role: 'complementary',
          'aria-label': translate('label'),
          style: { ...position, width: view.width + 'px', maxHeight: view.maxHeight + 'px' },
        },
        h('div', { className: 'dsh-qp-head' },
          h('span', { className: 'dsh-qp-badge' }, String(view.ordinal)),
          h('span', { className: 'dsh-qp-title' }, translate('title')),
          h('div', { className: 'dsh-qp-actions' },
            action(translate('jump'), jump, JUMP_ICON),
            action(translate('copy'), copy, copied ? CHECK_ICON : COPY_ICON, copied ? { 'data-copied': 'true' } : null),
            action(translate('collapse'), () => setCollapsedKey(view.key), CHEVRON_UP_ICON),
          ),
        ),
        attach,
        // An image-only or file-only question has nothing left to show here.
        view.text === '' ? null : h('div', {
          className: 'dsh-qp-text',
          ref: textRef,
          tabIndex: 0,
        }, view.text))

      const content = h('div', { ref: rootRef, className: 'dsh-qp-root' },
        h('style', { key: 'style' }, CSS),
        surface)

      return h(React.Fragment, null,
        marker,
        createPortal !== null && typeof document !== 'undefined' && document.body !== null
          ? createPortal(content, document.body)
          : content)
    }

    let applied = false

    return {
      name: 'dsh-question-pin',
      inject: ['slots', 'locale'],
      apply(ctx) {
        if (applied) return
        applied = true
        ctx.effect(() => ctx.locale.register(NAMESPACE, { zh: ZH, en: EN }), 'question-pin.locale')
        const translate = ctx.locale.bind(NAMESPACE)
        ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
          name: 'conversation.input.overlay',
          id: 'question-pin',
          order: 40,
          label: () => translate('label'),
          locale: NAMESPACE,
        }, QuestionPin))
      },
    }
  },
})