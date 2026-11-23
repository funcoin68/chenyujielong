import { useState } from 'react'
import './RoomSettings.css'

export interface RoomSettingsValues {
  name: string
  rule: 'strict' | 'homophone'
  turnSeconds: number
  maxPlayers: number
  winCondition: 'rounds' | 'elimination'
  dictionary: 'common' | 'full'
}

export interface RoomSettingsProps {
  submitLabel: string
  onSubmit: (settings: RoomSettingsValues) => void
  /** CYJ-27: initial room name derived from the signed-in user. Empty/undefined
   *  renders the field empty with its placeholder — never another user's name. */
  defaultName?: string
}

/** CYJ-27: first whitespace-separated token + "'s room" ("Wei Chen" →
 *  "Wei's room", "小明" → "小明's room"); empty/missing → '' (the placeholder
 *  shows). */
export function defaultRoomName(displayName: string | null | undefined): string {
  const first = displayName?.trim().split(/\s+/)[0] ?? ''
  return first ? `${first}'s room` : ''
}

const TIMER_OPTIONS = [15, 30, 60]
const PLAYER_COUNTS = [2, 3, 4, 5, 6]

/**
 * S3 — Create Room form. Every control has a default; the primary button is
 * always enabled (spec S3). Shared by the Lobby create modal and the
 * waiting-room host settings.
 */
export function RoomSettings({ submitLabel, onSubmit, defaultName }: RoomSettingsProps) {
  const [name, setName] = useState(defaultName ?? '')
  const [rule, setRule] = useState<'strict' | 'homophone'>('strict')
  const [timer, setTimer] = useState(30)
  const [players, setPlayers] = useState(4)
  const [win, setWin] = useState<'rounds' | 'elimination'>('rounds')
  const [dict, setDict] = useState<'common' | 'full'>('common')

  return (
    <form
      className="room-settings"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ name, rule, turnSeconds: timer, maxPlayers: players, winCondition: win, dictionary: dict })
      }}
    >
      <label className="room-settings-field">
        <span className="room-settings-label">Room name</span>
        <input
          className="room-settings-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Room name"
          maxLength={24}
        />
      </label>

      <fieldset className="room-settings-field">
        <legend className="room-settings-label">Chain rule</legend>
        <label>
          <input
            type="radio"
            name="rule"
            checked={rule === 'strict'}
            onChange={() => setRule('strict')}
          />{' '}
          Strict 末字接龙
        </label>
        <label>
          <input
            type="radio"
            name="rule"
            checked={rule === 'homophone'}
            onChange={() => setRule('homophone')}
          />{' '}
          Homophone 同音可接
        </label>
      </fieldset>

      <fieldset className="room-settings-field">
        <legend className="room-settings-label">Turn timer</legend>
        <div className="room-settings-chips" role="group" aria-label="Turn timer">
          {TIMER_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip room-settings-chip${timer === s ? ' chip-selected' : ''}`}
              aria-pressed={timer === s}
              onClick={() => setTimer(s)}
            >
              {s}s
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="room-settings-field">
        <legend className="room-settings-label">Players</legend>
        <div className="room-settings-chips" role="group" aria-label="Players">
          {PLAYER_COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              className={`chip room-settings-chip${players === n ? ' chip-selected' : ''}`}
              aria-pressed={players === n}
              onClick={() => setPlayers(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="room-settings-field">
        <legend className="room-settings-label">Win condition</legend>
        <label>
          <input
            type="radio"
            name="win"
            checked={win === 'rounds'}
            onChange={() => setWin('rounds')}
          />{' '}
          Best of 5 rounds
        </label>
        <label>
          <input
            type="radio"
            name="win"
            checked={win === 'elimination'}
            onChange={() => setWin('elimination')}
          />{' '}
          Elimination 淘汰制
        </label>
      </fieldset>

      <fieldset className="room-settings-field">
        <legend className="room-settings-label">Dictionary</legend>
        <label>
          <input
            type="radio"
            name="dict"
            checked={dict === 'common'}
            onChange={() => setDict('common')}
          />{' '}
          Common 常用 (≈5k)
        </label>
        <label>
          <input
            type="radio"
            name="dict"
            checked={dict === 'full'}
            onChange={() => setDict('full')}
          />{' '}
          Full 全词典 (≈30k)
        </label>
      </fieldset>

      <button type="submit" className="btn btn-primary btn-lg">
        {submitLabel}
      </button>
    </form>
  )
}
