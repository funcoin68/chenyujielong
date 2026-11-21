import { lastChar } from '../lib/chain'
import type { ChainEntry, MockPlayer } from '../mock/data'
import { IdiomTile } from './IdiomTile'
import './ChainView.css'

export interface ChainViewProps {
  entries: ChainEntry[]
  playersById: Record<string, MockPlayer>
  /** emphasize the last tile as the chain head (spec S6) */
  headEmphasis?: boolean
  /** pop-in animation on the newest tile (spec §2.5 chain grow) */
  animateNewest?: boolean
}

/**
 * Vertical idiom-chain timeline, newest at the bottom (spec S6: the star of
 * the screen). The connector between tiles shows the shared character,
 * teaching the rule every turn.
 */
export function ChainView({
  entries,
  playersById,
  headEmphasis = false,
  animateNewest = false,
}: ChainViewProps) {
  return (
    <ol className="chain-view">
      {entries.map((entry, i) => {
        const prev = i > 0 ? entries[i - 1] : undefined
        const player = playersById[entry.playerId]
        const isHead = headEmphasis && i === entries.length - 1
        return (
          <li key={`${entry.idiom}-${i}`} className="chain-view-item">
            {prev && (
              <div className="chain-connector" aria-hidden="true">
                <span className="chain-connector-char">{lastChar(prev.idiom)}</span>
              </div>
            )}
            <IdiomTile
              text={entry.idiom}
              points={entry.points}
              colorVar={player?.colorVar}
              playerName={player?.name}
              rare={entry.rare}
              head={isHead}
              entering={animateNewest && i === entries.length - 1}
            />
          </li>
        )
      })}
    </ol>
  )
}
