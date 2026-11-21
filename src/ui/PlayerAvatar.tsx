import './PlayerAvatar.css'

export interface PlayerAvatarProps {
  name: string
  /** player identity color (CSS var) for the ring (spec §2.2) */
  colorVar: string
  size?: number
  /** current turn: red 3px ring + springy scale (spec S6) */
  active?: boolean
  /** decorative by default — adjacent text always carries the name */
  ariaHidden?: boolean
}

/** Circular avatar with a player-color ring; red ring marks the current turn. */
export function PlayerAvatar({
  name,
  colorVar,
  size = 48,
  active = false,
  ariaHidden = true,
}: PlayerAvatarProps) {
  return (
    <span
      className={`player-avatar${active ? ' player-avatar--active' : ''}`}
      style={{ width: size, height: size, borderColor: colorVar, fontSize: size * 0.4 }}
      role={ariaHidden ? undefined : 'img'}
      aria-hidden={ariaHidden || undefined}
      aria-label={ariaHidden ? undefined : name}
    >
      {Array.from(name)[0]}
    </span>
  )
}
