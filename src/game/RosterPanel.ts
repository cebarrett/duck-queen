import type { RosterEntry } from './Flock'
import { type SubjectKind, type DucklingTrait, DUCKLING_TRAITS } from './subjectKinds'
import type { SubjectActivity } from './DuckSubject'

/**
 * RosterPanel owns the 🪶 Roster button (bottom-left, above the Quests button) and
 * the centred window it toggles: the royal flock roster, listing every drake, hen,
 * and duckling the Queen leads as its own named entry, grouped by kind.
 *
 * Like the HUD banners and the SettingsMenu, it builds its DOM in code and appends
 * it to <body>. The button and panel opt into `pointer-events:auto` (the rest of
 * the overlay lets clicks fall through to the canvas for pointer lock); the J-style
 * toggle is also driven from a key via Game.
 */

// How each kind is titled and badged in the window, in display order.
const SECTIONS: { kind: SubjectKind; icon: string; label: string }[] = [
  { kind: 'drake', icon: '♂', label: 'Drakes' },
  { kind: 'hen', icon: '♀', label: 'Hens' },
  { kind: 'duckling', icon: '🐤', label: 'Ducklings' },
]

// A subject's quirk badge, e.g. "🏃 Fast runner", keyed off the shared trait table.
const TRAIT_BADGE: Record<DucklingTrait, string> = Object.fromEntries(
  DUCKLING_TRAITS.map((t) => [t.id, `${t.icon} ${t.label}`]),
) as Record<DucklingTrait, string>

// A friendly icon + label for whatever a subject is up to right now.
const ACTIVITY: Record<SubjectActivity, string> = {
  following: '🚶 Following',
  foraging: '🌿 Foraging',
  distracted: '👀 Distracted',
  scattered: '💨 Scattered',
  holding: '🏠 Holding home',
  nesting: '🥚 Brooding',
  worming: '🪱 Tugging a worm',
}

export class RosterPanel {
  private readonly panel: HTMLElement
  private readonly entries: HTMLElement
  private open = false
  private lastHtml = '' // only touch the DOM when the rendered roster changes

  constructor() {
    const button = document.createElement('button')
    button.textContent = '🪶 Roster (K)'
    button.style.cssText =
      'position:fixed;left:14px;bottom:56px;pointer-events:auto;cursor:pointer;' +
      'background:rgba(16,20,27,.82);color:#f3f6f9;font:600 15px system-ui,sans-serif;' +
      'border:2px solid rgba(238,241,245,.85);border-radius:10px;padding:8px 14px;' +
      'text-shadow:0 1px 2px rgba(0,0,0,.55);box-shadow:0 2px 8px rgba(0,0,0,.35);z-index:10;'
    button.addEventListener('click', () => this.toggle())
    document.body.appendChild(button)

    // The window: a centred, scrollable card matching the quest log, hidden until opened.
    const panel = document.createElement('div')
    panel.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
      'width:min(520px,90vw);max-height:80vh;overflow:auto;' +
      'background:rgba(16,20,27,.92);border:2px solid rgba(238,241,245,.85);' +
      'border-radius:14px;padding:20px 24px;color:#f3f6f9;' +
      'text-shadow:0 1px 2px rgba(0,0,0,.55);pointer-events:auto;user-select:none;display:none;z-index:10;'
    const header = document.createElement('div')
    header.textContent = '👑 Royal Flock Roster'
    header.style.cssText = 'font-size:22px;font-weight:800;letter-spacing:.2px;'
    const subtitle = document.createElement('div')
    subtitle.textContent = 'Your subjects, one and all'
    subtitle.style.cssText = 'font-size:13px;font-weight:700;color:#cfe0f5;opacity:.8;margin:2px 0 14px;'
    const entries = document.createElement('div')
    panel.appendChild(header)
    panel.appendChild(subtitle)
    panel.appendChild(entries)
    document.body.appendChild(panel)
    this.panel = panel
    this.entries = entries
  }

  /** Open or close the roster window (from the 🪶 button or the K key). */
  toggle(): void {
    this.open = !this.open
    this.panel.style.display = this.open ? 'block' : 'none'
  }

  /** Fill the window from the current roster. Grouped by kind, each subject its own
   *  row of name + what it's doing. Only touches the DOM when the rendered content
   *  changes (like the quest log), so it's cheap to call every frame. */
  setRoster(roster: readonly RosterEntry[]): void {
    let html = ''
    for (const section of SECTIONS) {
      const members = roster.filter((r) => r.kind === section.kind)
      if (members.length === 0) continue
      html +=
        '<div style="border-top:1px solid rgba(238,241,245,.18);padding:12px 0 6px;">' +
        `<div style="font-size:13px;font-weight:800;color:#cfe0f5;letter-spacing:.4px;">` +
        `${section.icon} ${section.label} · ${members.length}</div>` +
        members
          .map(
            (m) =>
              '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-top:7px;">' +
              `<span style="font-size:16px;font-weight:700;">${m.name}` +
              (m.trait
                ? `<span style="font-size:12px;font-weight:600;opacity:.7;margin-left:8px;white-space:nowrap;">${TRAIT_BADGE[m.trait]}</span>`
                : '') +
              '</span>' +
              `<span style="font-size:13px;font-weight:600;opacity:.85;white-space:nowrap;">${ACTIVITY[m.activity]}</span>` +
              '</div>',
          )
          .join('') +
        '</div>'
    }
    if (html === '') {
      html =
        '<div style="border-top:1px solid rgba(238,241,245,.18);padding:16px 0;font-size:15px;opacity:.7;">' +
        'No subjects yet — press <b>Q</b> to quack and rally nearby ducks to your side.' +
        '</div>'
    }

    // The values are our own copy strings + integers (names come from a fixed pool),
    // so nothing untrusted goes into innerHTML here (same reasoning as the HUD).
    if (html !== this.lastHtml) {
      this.entries.innerHTML = html
      this.lastHtml = html
    }
  }
}
