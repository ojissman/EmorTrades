// Task 177 — derivatives contract multipliers.
// A futures trade's P&L is NOT qty × price-move: each contract controls a
// fixed notional (GC=F = 100 troy ounces, ES=F = 50 index points…). The
// journal stores `multiplier` per trade (default 1 = no leverage scaling,
// correct for stocks/crypto and for forex where qty is lot-sized).
//
// Sourced from exchange contract specs (CME/COMEX). Micro/mini contracts
// included — retail traders usually trade those.

export const FUTURES_MULTIPLIERS: Record<string, number> = {
  // Metals (COMEX) — the journal's own gold/silver instruments live here
  'GC=F': 100, // Gold, 100 troy oz
  'MGC=F': 10, // Micro Gold
  'SI=F': 5000, // Silver, 5000 troy oz
  'SIL=F': 1000, // Micro Silver
  'HG=F': 25000, // Copper
  'MHG=F': 2500, // Micro Copper
  'PL=F': 50, // Platinum
  'PA=F': 100, // Palladium
  // Equity indices (CME)
  'ES=F': 50, // E-mini S&P 500
  'MES=F': 5, // Micro E-mini S&P 500
  'NQ=F': 20, // E-mini Nasdaq 100
  'MNQ=F': 2, // Micro E-mini Nasdaq 100
  'YM=F': 5, // E-mini Dow
  'MYM=F': 0.5, // Micro E-mini Dow
  'RTY=F': 50, // E-mini Russell 2000
  'M2K=F': 5, // Micro E-mini Russell 2000
  // Energy (NYMEX)
  'CL=F': 1000, // WTI Crude
  'MCL=F': 100, // Micro WTI
  'BZ=F': 1000, // Brent
  'NG=F': 10000, // Natural Gas (mmBtu)
  'QG=F': 2500, // E-mini NatGas
  'RB=F': 42000, // RBOB Gasoline
  'HO=F': 42000, // Heating Oil
  // Rates (CBOT) — decimal-priced, multipliers are per full point
  'ZN=F': 1000, // 10-Year T-Note
  'ZB=F': 1000, // 30-Year T-Bond
  'ZF=F': 1000, // 5-Year T-Note
  'ZT=F': 2000, // 2-Year T-Note
  // Agriculture (CBOT) — most-traded
  'ZC=F': 5000, // Corn
  'ZS=F': 5000, // Soybeans
  'ZW=F': 5000, // Wheat
  'ZM=F': 100, // Soybean Meal
  'ZO=F': 5000, // Oats
  // Crypto futures (CME)
  'BTC=F': 5, // Bitcoin
  'MBT=F': 0.1, // Micro Bitcoin
  'ETH=F': 50, // Ether
  'MET=F': 0.1, // Micro Ether
}

// Try to infer a multiplier from a raw symbol the trader typed. Matches the
// map first (exact), then common aliases (GC, MGC, GOLD -> GC=F handled by the
// market resolver upstream, so here we only cover direct contract tickers).
export function suggestMultiplier(symbol: string | null | undefined, assetClass?: string | null): number {
  if (!symbol) return 1
  const s = symbol.trim().toUpperCase()
  if (FUTURES_MULTIPLIERS[s] != null) return FUTURES_MULTIPLIERS[s]
  // Non-futures asset classes never carry a contract multiplier (accepts
  // both 'futures' and 'future' spellings used across the UI)
  const ac = assetClass?.trim().toLowerCase()
  if (ac && !ac.startsWith('future')) return 1
  // Bare roots without the =F suffix (brokers often export "ES" / "NQ")
  const root = s.replace(/[-_ ]?PERP$/i, '')
  if (FUTURES_MULTIPLIERS[`${root}=F`] != null) return FUTURES_MULTIPLIERS[`${root}=F`]
  return 1
}

export function isKnownFuture(symbol: string | null | undefined): boolean {
  if (!symbol) return false
  const s = symbol.trim().toUpperCase()
  if (FUTURES_MULTIPLIERS[s] != null) return true
  return FUTURES_MULTIPLIERS[`${s.replace(/[-_ ]?PERP$/i, '')}=F`] != null
}
