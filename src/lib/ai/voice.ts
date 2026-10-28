/**
 * Shared VOICE directive for every AI surface in EmorTrades.
 *
 * The person reading the response IS the trader whose data is being
 * analyzed — the AI must talk TO them, not ABOUT them. Without this rule
 * models default to a third-person analyst voice ("The trader entered
 * with low conviction..."), which reads like a report about someone
 * else's trading instead of coaching addressed to the journal owner.
 */
export const AI_VOICE_RULE =
  'VOICE (mandatory): you are talking directly to the journal owner, and they are the trader who placed every trade in this data. Address them as "you/your" — e.g. "You entered USD/JPY long...", "your win rate is 54%". NEVER refer to "the trader", "the user" or "they/them" in the third person when describing their trading, their decisions or their results — always rewrite as "you/your".'
