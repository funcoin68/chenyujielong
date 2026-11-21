/**
 * CYJ-6 mock fixtures — the entire mock-up renders from this module.
 * No Supabase, no auth, no network calls (AC #2).
 */

export interface MockPlayer {
  id: string
  name: string
  /** CSS var holding the player's identity color (spec §2.2) */
  colorVar: string
  ready: boolean
  isHost?: boolean
  isYou?: boolean
}

export interface ChainEntry {
  idiom: string
  pinyin: string
  playerId: string
  points: number
  rare?: boolean
}

export const PLAYERS: MockPlayer[] = [
  { id: 'p1', name: 'Wei', colorVar: 'var(--player-4)', ready: true, isHost: true, isYou: true },
  { id: 'p2', name: 'Ana', colorVar: 'var(--player-2)', ready: true },
  { id: 'p3', name: 'Ken', colorVar: 'var(--player-3)', ready: false },
  { id: 'p4', name: 'Mia', colorVar: 'var(--player-5)', ready: true },
]

export const PLAYERS_BY_ID: Record<string, MockPlayer> = Object.fromEntries(
  PLAYERS.map((p) => [p.id, p]),
)

/** Live scores for the gameplay rail (spec S6 wireframe). */
export const GAME_SCORES: Record<string, number> = { p1: 95, p2: 120, p3: 140, p4: 80 }

/** Whose turn it is in the gameplay mock (you). */
export const ACTIVE_PLAYER_ID = 'p1'

/** Spec S1a example chain, reused for the how-to-play sheet and landing demo. */
export const DEMO_CHAIN: ChainEntry[] = [
  { idiom: '一心一意', pinyin: 'yī xīn yī yì', playerId: 'p2', points: 12 },
  { idiom: '意味深长', pinyin: 'yì wèi shēn cháng', playerId: 'p3', points: 15 },
  { idiom: '长篇大论', pinyin: 'cháng piān dà lùn', playerId: 'p1', points: 11 },
]

/** In-progress game chain (spec S6 wireframe: head is 意味深长 → chain from 长). */
export const GAME_CHAIN: ChainEntry[] = [
  { idiom: '一心一意', pinyin: 'yī xīn yī yì', playerId: 'p2', points: 12 },
  { idiom: '意味深长', pinyin: 'yì wèi shēn cháng', playerId: 'p3', points: 15 },
]

/** Pinyin of the character the next move must start with (长 = cháng here). */
export const CHAIN_CHAR_PINYIN: Record<string, string> = { 长: 'cháng' }

/** Suggestion chips for the current chain character (spec S6 input row). */
export const SUGGESTIONS: Record<string, string[]> = {
  长: ['长年累月', '长治久安'],
}

export const ROOM = {
  id: 'demo',
  name: "Wei's room",
  code: 'K7Q2M9',
  maxPlayers: 6,
  settings: {
    rule: 'strict' as 'strict' | 'homophone',
    turnSeconds: 30,
    winCondition: 'rounds' as 'rounds' | 'elimination',
    dictionary: 'common' as 'common' | 'full',
  },
}

export const ROUND = { current: 2, total: 5 }

export interface LobbyRoom {
  name: string
  occupancy: string
  status: 'waiting' | 'in-progress'
  modes: string[]
}

export const LOBBY_ROOMS: LobbyRoom[] = [
  { name: '小明的房间', occupancy: '3/6', status: 'waiting', modes: ['homophone'] },
  { name: '成语高手局', occupancy: '5/6', status: 'in-progress', modes: ['strict'] },
]

export interface RecentGame {
  placement: number
  playerCount: number
  date: string
}

export const RECENT_GAMES: RecentGame[] = [
  { placement: 1, playerCount: 4, date: '2026-11-20' },
  { placement: 3, playerCount: 6, date: '2026-11-18' },
  { placement: 2, playerCount: 3, date: '2026-11-15' },
]

export interface Standing {
  name: string
  colorVar: string
  score: number
  idioms: number
  isYou?: boolean
}

export const STANDINGS: Standing[] = [
  { name: 'Ken', colorVar: 'var(--player-3)', score: 240, idioms: 12 },
  { name: 'Ana', colorVar: 'var(--player-2)', score: 220, idioms: 11 },
  { name: 'You', colorVar: 'var(--player-4)', score: 195, idioms: 10, isYou: true },
  { name: 'Mia', colorVar: 'var(--player-5)', score: 160, idioms: 8 },
]

export const BEST_PLAY = { idiom: '鲧禹治水', pinyin: 'gǔn yǔ zhì shuǐ', points: 20, by: 'Ken' }

/** Per-player chains for the expandable results rows. */
export const RESULT_CHAINS: Record<string, string[]> = {
  Ken: ['一心一意', '意味深长', '长篇大论', '鲧禹治水'],
  Ana: ['车水马龙', '龙飞凤舞', '舞文弄墨'],
  You: ['海阔天空', '空前绝后', '后来居上'],
  Mia: ['画蛇添足', '足智多谋'],
}

export const PROFILE = {
  name: 'Wei',
  email: 'wei@gmail.com',
  memberSince: '2026-01-12',
  streak: 3,
  stats: {
    gamesPlayed: 27,
    winRate: '41%',
    longestChain: 18,
    favoriteIdiom: '一心一意',
  },
  history: [
    { placement: 1, playerCount: 4, date: '2026-11-20' },
    { placement: 3, playerCount: 6, date: '2026-11-18' },
    { placement: 2, playerCount: 3, date: '2026-11-15' },
    { placement: 1, playerCount: 5, date: '2026-11-10' },
  ],
}

/** Waiting-room quick chat presets (spec S5 — emoji are content here, not icons). */
export const QUICK_CHAT = ['👍', '😂', '🔥', 'good luck!', 'hurry up 😅']
