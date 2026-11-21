import './IdiomTile.css'

export interface IdiomTileProps {
  text: string
  /** chain = 32px (in-chain), slot = 40px (current slot), results = 24px */
  size?: 'chain' | 'slot' | 'results'
  /** points earned, shown in the scoring player's color */
  points?: number
  colorVar?: string
  playerName?: string
  rare?: boolean
  /** chain head: emphasized with brand-red outline (spec S6) */
  head?: boolean
  /** play the chain-grow pop-in animation (spec §2.5) */
  entering?: boolean
}

/** The atomic UI unit (spec §2.4): rounded tile with a 2px stamp edge. */
export function IdiomTile({
  text,
  size = 'chain',
  points,
  colorVar,
  playerName,
  rare = false,
  head = false,
  entering = false,
}: IdiomTileProps) {
  const classes = [
    'idiom-tile',
    `idiom-tile--${size}`,
    head ? 'idiom-tile--head' : '',
    entering ? 'idiom-tile--enter' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes}>
      <span className="idiom-tile-text">{text}</span>
      {rare && (
        <span className="idiom-tile-rare" role="img" aria-label="rare idiom">
          ✦
        </span>
      )}
      {points !== undefined && (
        <span className="idiom-tile-points" style={colorVar ? { color: colorVar } : undefined}>
          +{points}
        </span>
      )}
      {playerName && colorVar && (
        <span
          className="idiom-tile-owner"
          style={{ background: colorVar }}
          role="img"
          aria-label={`played by ${playerName}`}
        >
          {Array.from(playerName)[0]}
        </span>
      )}
    </div>
  )
}
