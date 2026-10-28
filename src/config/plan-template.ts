/**
 * ============================================================================
 * TRADING PLAN QUESTION REGISTRY (TP)
 * ============================================================================
 * The single source of truth for the Trading Plan feature, transcribed from
 * trading-plan-master-template.md (Oct 21, 2026). It drives:
 *   · the plan editor (nine sections, per level),
 *   · the checklist generator (checklistSource entries),
 *   · the rule projection on publish (rule entries).
 *
 * Question text, numbering and section order come from the master template
 * exactly. Content answers are stored per version keyed by `key`
 * (e.g. "4.7.5.3"); templateVersion pins which question set produced a
 * version so old versions still render when this registry changes.
 *
 * Levels:
 *   · plan   — sections 1-3, 5-9 and 4.0 (the plan's own sections)
 *   · system — sections 4.1-4.6 and 4.8-4.13 (repeated per system)
 *   · setup  — section 4.7 (repeated per setup inside a system)
 */

export type PlanLevel = 'plan' | 'system' | 'setup'
export type PlanInput =
  | 'text' | 'longtext' | 'number' | 'money' | 'percent' | 'rating'
  | 'enum' | 'multienum' | 'tags' | 'list' | 'table' | 'date' | 'duration'

export interface PlanQuestion {
  key: string
  level: PlanLevel
  section: number
  label: string
  hint: string
  input: PlanInput
  options?: string[]
  unit?: string
  checklistSource?: boolean
  rule?: { type: 'hard' | 'judgment' | 'process'; metric: string }
}

export const TEMPLATE_VERSION = '1.0.0'

export const PLAN_SECTIONS: { n: number; title: string; level: PlanLevel }[] = [
  { n: 1, title: 'Self Assessment', level: 'plan' },
  { n: 2, title: 'Market Philosophy', level: 'plan' },
  { n: 3, title: 'Objectives and Goals', level: 'plan' },
  { n: 4, title: 'Systems', level: 'system' },
  { n: 5, title: 'Risk and Money Management', level: 'plan' },
  { n: 6, title: 'Psychology', level: 'plan' },
  { n: 7, title: 'Daily Operations', level: 'plan' },
  { n: 8, title: 'Discipline', level: 'plan' },
  { n: 9, title: 'Plan Governance', level: 'plan' },
]

const SETUP_STATUS = ['concept', 'testing', 'live_small', 'live_full', 'paused', 'retired']

// ---------- Section 1 · Self Assessment (plan) ----------
const S1: PlanQuestion[] = [
  { key: '1.1.1', level: 'plan', section: 1, label: 'Why do I want to be a trader?', hint: 'The honest motive (money, freedom, challenge, status, escape, proving something) and what I expect trading to give me beyond money', input: 'longtext' },
  { key: '1.1.2', level: 'plan', section: 1, label: 'Why trading, and why now?', hint: 'What I considered instead, and what in my life led to this decision', input: 'longtext' },
  { key: '1.2.1', level: 'plan', section: 1, label: 'Who am I outside trading?', hint: 'Age and life stage, occupation, other income, dependents, debts, fixed obligations, and how much financial pressure I carry into the account', input: 'longtext' },
  { key: '1.2.2', level: 'plan', section: 1, label: 'How much time during the day do I have to devote to trading?', hint: 'Hours, days and sessions this realistically allows', input: 'text' },
  { key: '1.2.3', level: 'plan', section: 1, label: 'When I am trading, how many distractions can I expect to have? How will I deal with those distractions?', hint: 'Work, family, environment, notifications, each with a specific response', input: 'longtext' },
  { key: '1.2.4', level: 'plan', section: 1, label: 'What do my energy and lifestyle allow?', hint: 'Sleep, health, daily rhythm, peak hours', input: 'text' },
  { key: '1.3.1', level: 'plan', section: 1, label: 'What is my style?', hint: 'My natural pace and preferences: patient or urgent, analytical or intuitive, fast or slow, solo or with input, and how these change under pressure. The trading style itself is defined in section 4, and checked against this answer', input: 'longtext' },
  { key: '1.3.2', level: 'plan', section: 1, label: 'How do I handle stress and setbacks?', hint: 'Whether I withdraw, push harder, blame, analyze or avoid', input: 'longtext' },
  { key: '1.4.1', level: 'plan', section: 1, label: 'What are my strengths and weaknesses? What are my psychological strengths and weaknesses, especially in terms of trading system development?', hint: 'Specific strengths and weaknesses, not general traits', input: 'longtext' },
  { key: '1.4.2', level: 'plan', section: 1, label: 'What are my strengths and weaknesses in terms of personal discipline?', hint: 'Where I keep commitments and where I do not', input: 'longtext' },
  { key: '1.4.3', level: 'plan', section: 1, label: 'What are my blind spots?', hint: 'The things I am least likely to notice about myself, which the rest of the plan must guard against', input: 'longtext' },
  { key: '1.5.1', level: 'plan', section: 1, label: 'Do I tend to get compulsive? (i.e., get caught up in the excitement of trading)', hint: 'Examples, and what set it off', input: 'longtext' },
  { key: '1.5.2', level: 'plan', section: 1, label: 'Do I have personal conflicts? (i.e., a history of conflicts with my family, at my job, or during past trading experience)', hint: 'The pattern, not the story', input: 'longtext' },
  { key: '1.5.3', level: 'plan', section: 1, label: 'Do I have any emotional issues that constantly crop up, such as fear or anger?', hint: 'Which emotions, and when they usually show up', input: 'longtext' },
  { key: '1.5.4', level: 'plan', section: 1, label: 'What is my trading history?', hint: 'Past results, blow-ups, what they taught me, and approaches I tried and dropped. The facts are recorded here and interpreted in 6.1', input: 'longtext' },
  { key: '1.6.1', level: 'plan', section: 1, label: 'Am I in the right frame of mind?', hint: 'An honest check at the time of writing: stability, current stressors, anything that says "not yet". The daily version is in 6.6 and 7.1', input: 'longtext' },
  { key: '1.7.1', level: 'plan', section: 1, label: 'What are my computer skills? What skills do I need before I begin this trading venture?', hint: 'Platforms, charting, data handling, automation, rated on a scale', input: 'rating' },
  { key: '1.7.2', level: 'plan', section: 1, label: 'What do I know about statistics?', hint: 'Whether I can judge my own results: expectancy, sample size, variance, drawdown. Rated on a scale', input: 'rating' },
  { key: '1.7.3', level: 'plan', section: 1, label: 'How would I rate my market knowledge?', hint: 'A rating for each market and instrument I intend to trade', input: 'rating' },
  { key: '1.8.1', level: 'plan', section: 1, label: 'How much time do I expect to devote to developing my trading system?', hint: 'Hours per week', input: 'number', unit: 'hours/week' },
  { key: '1.8.2', level: 'plan', section: 1, label: 'How much time do I expect to devote to doing my personal psychological work?', hint: 'Hours per week', input: 'number', unit: 'hours/week' },
  { key: '1.8.3', level: 'plan', section: 1, label: 'How much time do I expect to devote to working on my business plan for trading?', hint: 'Hours per week', input: 'number', unit: 'hours/week' },
]

// ---------- Section 2 · Market Philosophy (plan) ----------
const S2: PlanQuestion[] = [
  { key: '2.1.1', level: 'plan', section: 2, label: 'What do I believe the market fundamentally is?', hint: 'An auction, a competition between participants, a reflection of crowd behavior, a mostly random process, or something else', input: 'longtext' },
  { key: '2.1.2', level: 'plan', section: 2, label: 'Who else is in it, and who is on the other side of my trade?', hint: 'Institutions, retail traders, hedgers, algorithms, and why each is trading', input: 'longtext' },
  { key: '2.1.3', level: 'plan', section: 2, label: 'How efficient do I believe it is?', hint: 'Where it is efficient (so I should not try) and where I believe it is not', input: 'longtext' },
  { key: '2.2.1', level: 'plan', section: 2, label: 'What drives price?', hint: 'Order flow, liquidity, news, sentiment, fundamentals, positioning, time-of-day effects', input: 'longtext' },
  { key: '2.2.2', level: 'plan', section: 2, label: 'Does price trend, revert, or both, and under what conditions?', hint: 'The conditions that separate the two', input: 'longtext' },
  { key: '2.2.3', level: 'plan', section: 2, label: 'Can the future be predicted, or only responded to?', hint: 'My position on prediction versus probability, and what it means for how I act', input: 'longtext' },
  { key: '2.2.4', level: 'plan', section: 2, label: 'What do I believe about patterns?', hint: 'Whether they repeat, why they would, and what makes them stop working', input: 'longtext' },
  { key: '2.2.5', level: 'plan', section: 2, label: 'What beliefs do I have about entering the markets? How important do I believe entry to be?', hint: 'The belief only. The entry rules for each setup are in 4.7', input: 'longtext' },
  { key: '2.3.1', level: 'plan', section: 2, label: 'What does the market owe me?', hint: 'The honest answer should be "nothing"', input: 'text' },
  { key: '2.3.2', level: 'plan', section: 2, label: 'What can I control, and what can I not?', hint: 'Where my responsibility starts and ends. My beliefs about myself and loss are in 6.1', input: 'longtext' },
  { key: '2.4.1', level: 'plan', section: 2, label: 'Belief log — what is the status of each belief above?', hint: 'Each belief gets a record with a status (hypothesis, testing, validated, challenged), linked evidence for and against with dates, and the date last reviewed', input: 'table' },
]

// ---------- Section 3 · Objectives and Goals (plan) ----------
const S3: PlanQuestion[] = [
  { key: '3.1.1', level: 'plan', section: 3, label: 'What does success look like in 1, 3, 5 and 10 years?', hint: 'The trading business in words, before any numbers', input: 'longtext' },
  { key: '3.1.2', level: 'plan', section: 3, label: 'What role does trading play in my life?', hint: 'Full-time income, a supplement, long-term growth, a skill, or a stepping stone', input: 'text' },
  { key: '3.1.3', level: 'plan', section: 3, label: 'What does "enough" look like?', hint: 'The point at which the goal is met, so the target stops moving', input: 'longtext' },
  { key: '3.2.1', level: 'plan', section: 3, label: 'What are my annual trading goals?', hint: 'Outcome, performance, process and development goals, each with floor, target and stretch', input: 'table' },
  { key: '3.2.2', level: 'plan', section: 3, label: 'What are my monthly trading goals?', hint: 'The slice of each annual goal due this month', input: 'table' },
  { key: '3.2.3', level: 'plan', section: 3, label: 'What are my weekly trading goals?', hint: 'Mostly process goals, plus what the week must deliver toward the month', input: 'table' },
  { key: '3.2.4', level: 'plan', section: 3, label: 'What are my daily target goals?', hint: 'Process goals first (follow the plan, complete the routine). Any profit target is an optional floor and cap, not a number to hit, because a single daily profit target pushes toward overtrading', input: 'table' },
  { key: '3.3.1', level: 'plan', section: 3, label: 'How much money do I have personally?', hint: 'Total, and how much is trading capital', input: 'money' },
  { key: '3.3.2', level: 'plan', section: 3, label: 'How much of that money could I afford to lose? For example, most funds stop trading at 50 percent.', hint: 'An amount in currency and percent. The enforced tiers are owned by 5.3', input: 'money' },
  { key: '3.3.3', level: 'plan', section: 3, label: 'How much risk can I afford to take on a given trade?', hint: 'What I can afford. The ceiling that is actually enforced is in 5.3', input: 'percent' },
  { key: '3.3.4', level: 'plan', section: 3, label: 'What is my target capital at each horizon?', hint: 'Starting capital and target capital at 1, 3, 5 and 10 years', input: 'table' },
  { key: '3.4.1', level: 'plan', section: 3, label: 'How much money do I need to make each year?', hint: 'A figure, after tax', input: 'money' },
  { key: '3.4.2', level: 'plan', section: 3, label: 'Do I need to live off that money?', hint: 'Yes or no, and from when', input: 'text' },
  { key: '3.4.3', level: 'plan', section: 3, label: 'What if I do not make enough to live off?', hint: 'The fallback', input: 'longtext' },
  { key: '3.4.4', level: 'plan', section: 3, label: 'Can I make more than I need to live off, so that my trading capital can grow?', hint: 'The surplus I aim for and what happens to it', input: 'longtext' },
  { key: '3.4.5', level: 'plan', section: 3, label: 'Can I stand regular withdrawals from my trading capital to pay my monthly bills?', hint: 'Yes or no, and the effect on growth', input: 'text' },
  { key: '3.4.6', level: 'plan', section: 3, label: 'When does the business break even on its costs?', hint: 'The date, based on system costs from 4.4', input: 'text' },
  { key: '3.5.1', level: 'plan', section: 3, label: 'What is the maximum drawdown I will accept?', hint: 'The target, in percent and currency. Enforcement is in 5.3', input: 'percent' },
  { key: '3.5.2', level: 'plan', section: 3, label: 'What is my survival objective?', hint: 'Staying in the game long enough for the edge to prove itself', input: 'longtext' },
  { key: '3.5.3', level: 'plan', section: 3, label: 'What am I trying not to lose, apart from money?', hint: 'Time, health, relationships, confidence', input: 'text' },
  { key: '3.6.1', level: 'plan', section: 3, label: 'What expectancy, profit factor and average R am I aiming for?', hint: 'Compared with each setup\u2019s expected numbers (4.7)', input: 'text' },
  { key: '3.6.2', level: 'plan', section: 3, label: 'What consistency am I aiming for?', hint: 'Share of winning weeks or months, and the tolerable spread', input: 'text' },
  { key: '3.6.3', level: 'plan', section: 3, label: 'What does an acceptable losing period look like?', hint: 'So that normal variance is not mistaken for failure', input: 'longtext' },
  { key: '3.7.1', level: 'plan', section: 3, label: 'What plan adherence rate am I aiming for?', hint: 'Share of trades that follow the plan', input: 'percent' },
  { key: '3.7.2', level: 'plan', section: 3, label: 'What routine completion am I aiming for?', hint: 'Day plans, checklists, journal entries and reviews done on time', input: 'percent' },
  { key: '3.7.3', level: 'plan', section: 3, label: 'What are my targets for rule breaks?', hint: 'A maximum per week, and zero for the critical ones', input: 'text' },
  { key: '3.8.1', level: 'plan', section: 3, label: 'What skills do I need to build, and by when?', hint: 'Linked to the ratings in 1.7', input: 'table' },
  { key: '3.8.2', level: 'plan', section: 3, label: 'What system milestones am I aiming for?', hint: 'Defined, backtested, forward-tested, live', input: 'list' },
  { key: '3.8.3', level: 'plan', section: 3, label: 'What psychological work am I committing to?', hint: 'Goals only. The commitment is owned by 8.4', input: 'longtext' },
  { key: '3.9.1', level: 'plan', section: 3, label: 'What are my phases, and what is the objective of each?', hint: 'For example: learn and validate, trade small live, scale, mature. Early phases aim at proof and discipline, not profit', input: 'table' },
  { key: '3.9.2', level: 'plan', section: 3, label: 'What gates must be passed to move on?', hint: 'Cites the scaling gates owned by 5.11', input: 'list' },
  { key: '3.10.1', level: 'plan', section: 3, label: 'How will I know my plan is working, and how will I know when it is not?', hint: 'Measures and thresholds written in advance', input: 'longtext' },
  { key: '3.10.2', level: 'plan', section: 3, label: 'What do I expect from my system in various kinds of markets? Trending? Consolidating? Highly volatile?', hint: 'Expected results for each condition, so the AI can compare', input: 'longtext' },
  { key: '3.11.1', level: 'plan', section: 3, label: 'What would have to be true for these goals to be met, and does my edge and capital support them?', hint: 'Required return, trade count and win rate, compared with expected numbers. The gap, and what I do about it: lower the goal, add capital, extend the timeline, or improve the edge', input: 'longtext' },
  { key: '3.11.2', level: 'plan', section: 3, label: 'If goals conflict, which one wins, and what am I not willing to sacrifice?', hint: 'Growth against preservation, speed against discipline, income against learning', input: 'longtext' },
  { key: '3.11.3', level: 'plan', section: 3, label: 'When do I review goals, and when is changing one legitimate rather than rationalization?', hint: 'Fixed intervals, triggering events, and what counts as achieved, missed or failed', input: 'longtext' },
]

// ---------- Section 4.0 · The system portfolio (plan, once) ----------
const S4_0: PlanQuestion[] = [
  { key: '4.0.1', level: 'plan', section: 4, label: 'Which systems are in this plan, and what is the status of each?', hint: 'Name and status: concept, testing, live small, live full, paused, retired', input: 'table', options: SETUP_STATUS },
  { key: '4.0.2', level: 'plan', section: 4, label: 'How is capital allocated across systems, and how much is left unallocated as a buffer?', hint: 'Amount or percent per system, and the reason', input: 'table' },
  { key: '4.0.3', level: 'plan', section: 4, label: 'Why does each system exist alongside the others?', hint: 'What it covers that the others do not', input: 'longtext' },
  { key: '4.0.4', level: 'plan', section: 4, label: 'If two systems signal at once, which takes priority?', hint: 'A written order. Combined exposure limits are in 5.3', input: 'text' },
]

// ---------- Section 4.1-4.6 · System (per system) ----------
const S4_SYS: PlanQuestion[] = [
  { key: '4.1.1', level: 'system', section: 4, label: 'What is this system called, and what does it do in one sentence?', hint: 'Name and sentence', input: 'text' },
  { key: '4.1.2', level: 'system', section: 4, label: 'Is it discretionary, mechanical or hybrid?', hint: 'A mechanical system gives exact parameters. A discretionary system gives definitions plus an example library (4.7.3.4). This answer sets which fields are mandatory', input: 'enum', options: ['discretionary', 'mechanical', 'hybrid'] },
  { key: '4.1.3', level: 'system', section: 4, label: 'What is its status?', hint: 'Concept, testing, live small, live full, paused or retired', input: 'enum', options: SETUP_STATUS },
  { key: '4.1.4', level: 'system', section: 4, label: 'How much capital is allocated to it, and why?', hint: 'Ties to 4.0.2', input: 'money' },
  { key: '4.2.1', level: 'system', section: 4, label: 'Where does this system get paid, and by whom?', hint: 'One clear statement', input: 'longtext' },
  { key: '4.2.2', level: 'system', section: 4, label: 'What type of edge is it?', hint: 'Structural, behavioral, informational, speed, analytical or risk premium', input: 'enum', options: ['structural', 'behavioral', 'informational', 'speed', 'analytical', 'risk_premium'] },
  { key: '4.2.3', level: 'system', section: 4, label: 'Why does the edge exist, and why has it not been competed away?', hint: 'The reason the opportunity is there, and what would make it disappear', input: 'longtext' },
  { key: '4.2.4', level: 'system', section: 4, label: 'Why would I be the one to capture it?', hint: 'What I have that makes it my edge, checked against section 1', input: 'longtext' },
  { key: '4.2.5', level: 'system', section: 4, label: 'Which of my market beliefs does this system rely on?', hint: 'Links to the belief log in 2.4', input: 'text' },
  { key: '4.3.1', level: 'system', section: 4, label: 'Which markets will I trade?', hint: 'The markets, why these, and which I will deliberately stay out of', input: 'longtext' },
  { key: '4.3.2', level: 'system', section: 4, label: 'Which instruments will I trade? What kind of markets do I want to trade? Is it appropriate to specialize? Do I want to trade only liquid markets, or are there some illiquid markets I would like to trade?', hint: 'The instruments and the reasoning', input: 'multienum', rule: { type: 'hard', metric: 'instrument_in_scope' } },
  { key: '4.3.3', level: 'system', section: 4, label: 'What are the specifics of each instrument?', hint: 'Contract size, tick value, typical spread, trading hours, typical volatility', input: 'table' },
  { key: '4.3.4', level: 'system', section: 4, label: 'Which timeframes will I trade?', hint: 'Which I analyze on and which I execute on', input: 'tags', rule: { type: 'hard', metric: 'timeframe_in_scope' } },
  { key: '4.3.5', level: 'system', section: 4, label: 'Which sessions and days does it run, and what is the intended holding period?', hint: 'Structured start and end times with a timezone, checked against the time available in 1.2.2', input: 'table', rule: { type: 'hard', metric: 'session_in_scope' } },
  { key: '4.3.6', level: 'system', section: 4, label: 'In which market conditions does it apply, and in which does it explicitly not?', hint: 'Trending, ranging, high or low volatility, news or no news', input: 'tags' },
  { key: '4.3.7', level: 'system', section: 4, label: 'How do the instruments relate to each other?', hint: 'Correlation, and the maximum number I will hold at once', input: 'longtext' },
  { key: '4.4.1', level: 'system', section: 4, label: 'Which financial vehicle will I use to trade?', hint: 'Futures, CFDs, stocks and so on, why this one, and the leverage, costs and regulation that come with it', input: 'longtext' },
  { key: '4.4.2', level: 'system', section: 4, label: 'Which software and data feeds will I use to analyze?', hint: 'Analysis platform, charting, data quality, backtesting tools', input: 'longtext' },
  { key: '4.4.3', level: 'system', section: 4, label: 'Which broker and trading platform will I use to execute?', hint: 'Regulation, fund safety, execution quality, order types, and how the journal receives trade data', input: 'multienum', rule: { type: 'hard', metric: 'account_in_scope' } },
  { key: '4.4.4', level: 'system', section: 4, label: 'What is the backup for each of these?', hint: 'A backup platform or broker for this system', input: 'longtext' },
  { key: '4.4.5', level: 'system', section: 4, label: 'What does this system cost to run?', hint: 'Commissions, data and platform fees. Summed in 5.8', input: 'money' },
  { key: '4.5.1', level: 'system', section: 4, label: 'How do I read the market before looking for a trade?', hint: 'The top-down process', input: 'longtext' },
  { key: '4.5.2', level: 'system', section: 4, label: 'How do I decide directional bias, and when is the answer "no bias"?', hint: 'The rule', input: 'longtext' },
  { key: '4.5.3', level: 'system', section: 4, label: 'How do I classify conditions, and what do I expect from this system in each?', hint: 'Trending, consolidating, highly volatile, with expected results for each', input: 'longtext' },
  { key: '4.5.4', level: 'system', section: 4, label: 'Which key levels or reference points matter, and how are they marked?', hint: 'The list and the marking method', input: 'list' },
  { key: '4.5.5', level: 'system', section: 4, label: 'What context makes me skip the day or the instrument?', hint: 'The conditions', input: 'longtext' },
  { key: '4.6.1', level: 'system', section: 4, label: 'Which setups does this system recognize, and what is the status of each?', hint: 'The list. Each setup is detailed in 4.7', input: 'table', options: SETUP_STATUS },
  { key: '4.6.2', level: 'system', section: 4, label: 'If two setups appear at once, which takes priority?', hint: 'A written order', input: 'text' },
  { key: '4.6.3', level: 'system', section: 4, label: 'May I hold trades from two setups at the same time, and how do they count toward the risk ceiling?', hint: 'Concurrency rule', input: 'longtext' },
  { key: '4.6.4', level: 'system', section: 4, label: 'Do setups share the system\u2019s risk budget, or compete for it?', hint: 'Allocation rule', input: 'longtext' },
  { key: '4.6.5', level: 'system', section: 4, label: 'What happens if a trade matches no listed setup?', hint: 'No setup, no trade. Taking one is a plan break, reported as an unlisted setup', input: 'text' },
]

// ---------- Section 4.7 · Setup template (per setup) ----------
const S4_SETUP: PlanQuestion[] = [
  { key: '4.7.1.1', level: 'setup', section: 4, label: 'What is this setup called, and what is it in one line?', hint: 'Name and sentence', input: 'text' },
  { key: '4.7.1.2', level: 'setup', section: 4, label: 'What is its status?', hint: 'Concept, testing, live small, live full, paused or retired. A setup in testing carries reduced size limits and does not count in adherence', input: 'enum', options: SETUP_STATUS },
  { key: '4.7.1.3', level: 'setup', section: 4, label: 'What is its thesis?', hint: 'Why the pattern works inside the system\u2019s edge. One line if it simply inherits 4.2, and a separate statement if it is a different idea', input: 'longtext' },
  { key: '4.7.2.1', level: 'setup', section: 4, label: 'Which instruments, timeframes, sessions and market conditions does it run in?', hint: 'A subset of 4.3. It may narrow the system\u2019s scope, never widen it', input: 'table', rule: { type: 'hard', metric: 'instrument_in_scope' } },
  { key: '4.7.3.1', level: 'setup', section: 4, label: 'What exactly defines the setup?', hint: 'The required conditions', input: 'list', checklistSource: true, rule: { type: 'judgment', metric: 'required_condition' } },
  { key: '4.7.3.2', level: 'setup', section: 4, label: 'What invalidates it before entry?', hint: 'The conditions', input: 'list', checklistSource: true, rule: { type: 'judgment', metric: 'invalidator_absent' } },
  { key: '4.7.3.3', level: 'setup', section: 4, label: 'How do I grade it?', hint: 'A, B, or not tradable, with the criteria for each', input: 'enum', options: ['A', 'B', 'not_tradable'], rule: { type: 'hard', metric: 'grade_allowed' } },
  { key: '4.7.3.4', level: 'setup', section: 4, label: 'What does a textbook example look like, and what is a near miss that does not qualify?', hint: 'A screenshot library of approved examples and near misses. The AI judges my trades against it', input: 'longtext' },
  { key: '4.7.4.1', level: 'setup', section: 4, label: 'What is the trigger, the exact event that makes me act?', hint: 'One event', input: 'text', checklistSource: true, rule: { type: 'judgment', metric: 'trigger_met' } },
  { key: '4.7.4.2', level: 'setup', section: 4, label: 'What confirmation do I require, and what order type do I use?', hint: 'Confirmation and order type', input: 'text', checklistSource: true, rule: { type: 'judgment', metric: 'confirmation_met' } },
  { key: '4.7.4.3', level: 'setup', section: 4, label: 'What is the pre-trade checklist for this setup?', hint: 'Added to the system\u2019s general checks when I pick the setup', input: 'list', checklistSource: true },
  { key: '4.7.4.4', level: 'setup', section: 4, label: 'What stops me from entering even if the setup appears?', hint: 'Spread, news, time, daily limit, state of mind', input: 'list', checklistSource: true, rule: { type: 'judgment', metric: 'entry_blocker_absent' } },
  { key: '4.7.5.1', level: 'setup', section: 4, label: 'What is the probability of a successful trade?', hint: 'The expected win rate. Stated once, here, and compared with the realized rate', input: 'percent' },
  { key: '4.7.5.2', level: 'setup', section: 4, label: 'What is the risk/reward ratio?', hint: 'The expected ratio, and the minimum required to take the trade', input: 'number', checklistSource: true, rule: { type: 'hard', metric: 'min_reward_risk' } },
  { key: '4.7.5.3', level: 'setup', section: 4, label: 'What is my risk per trade?', hint: 'A percent and an amount, at or below the system ceiling (4.8)', input: 'percent', checklistSource: true, rule: { type: 'hard', metric: 'risk_pct_per_trade' } },
  { key: '4.7.5.4', level: 'setup', section: 4, label: 'Given my goals in terms of returns and drawdowns, what kind of initial risk stop do I want? If it is close, will I be able to get right back into the market so that I will not miss a move?', hint: 'The stop distance, the re-entry rule after being stopped out, and how many times I may re-enter the same idea', input: 'longtext' },
  { key: '4.7.5.5', level: 'setup', section: 4, label: 'Where will I place my stop loss orders?', hint: 'The placement rule and why there. When it may be set, whether it may be moved, and in which direction', input: 'longtext', checklistSource: true, rule: { type: 'hard', metric: 'stop_set' } },
  { key: '4.7.5.6', level: 'setup', section: 4, label: 'How will I determine my position size?', hint: 'A formula built from 4.7.5.3 and the stop distance, using the approach chosen in 5.6, never a feeling', input: 'longtext', checklistSource: true, rule: { type: 'hard', metric: 'size_matches_formula' } },
  { key: '4.7.6.1', level: 'setup', section: 4, label: 'What do I do after entry?', hint: 'Monitoring, and whether I intervene at all', input: 'longtext' },
  { key: '4.7.6.2', level: 'setup', section: 4, label: 'How will I lock in profits?', hint: 'Break-even moves, trailing, partials and adding to winners, and which applies when', input: 'longtext' },
  { key: '4.7.6.3', level: 'setup', section: 4, label: 'What do I do when news hits an open trade, or when price behaves unexpectedly?', hint: 'The rule', input: 'longtext' },
  { key: '4.7.6.4', level: 'setup', section: 4, label: 'What is the rule for a trade that goes nowhere?', hint: 'A time stop', input: 'text' },
  { key: '4.7.7.1', level: 'setup', section: 4, label: 'Losing trades — will I exit before my stop is hit? (exit completely)', hint: 'The exit-completely rule for losing trades', input: 'longtext' },
  { key: '4.7.7.2', level: 'setup', section: 4, label: 'Losing trades — which signals will see me scaling out of the trade?', hint: 'The scale-out rule for losing trades', input: 'longtext' },
  { key: '4.7.7.3', level: 'setup', section: 4, label: 'Winning trades — which signals will see me exit completely?', hint: 'The exit-completely rule for winning trades', input: 'longtext' },
  { key: '4.7.7.4', level: 'setup', section: 4, label: 'Winning trades — which signals will see me scaling out of the trade?', hint: 'The scale-out rule for winning trades', input: 'longtext' },
  { key: '4.7.7.5', level: 'setup', section: 4, label: 'What are the profit targets, and how are they set?', hint: 'The planned exit, as against signal exits', input: 'longtext' },
  { key: '4.7.7.6', level: 'setup', section: 4, label: 'Which discretionary exits are allowed, and which are forbidden?', hint: 'Two lists. A forbidden exit is a rule break', input: 'longtext' },
  { key: '4.7.7.7', level: 'setup', section: 4, label: 'What happens at session end, over the weekend, and around news?', hint: 'The rule', input: 'longtext' },
  { key: '4.7.8.1', level: 'setup', section: 4, label: 'What do I expect?', hint: 'Average win against average loss, expectancy per trade, trades per week', input: 'text' },
  { key: '4.7.8.2', level: 'setup', section: 4, label: 'What is normal variance?', hint: 'The longest losing streak and deepest drawdown I should expect even when the setup is working', input: 'text' },
  { key: '4.7.8.3', level: 'setup', section: 4, label: 'What sample size do I need before I trust any result?', hint: 'A number of trades', input: 'number', unit: 'trades' },
  { key: '4.7.8.4', level: 'setup', section: 4, label: 'What evidence do I need before moving up a stage, and how much?', hint: 'Backtest, forward test, live small', input: 'longtext' },
  { key: '4.7.8.5', level: 'setup', section: 4, label: 'What would disprove this setup?', hint: 'A falsifiable statement, written before it goes live', input: 'longtext' },
  { key: '4.7.8.6', level: 'setup', section: 4, label: 'What are the signs of decay, and which thresholds trigger a review?', hint: 'Metrics, thresholds, and what happens next. The plan-level response is in 5.11', input: 'longtext' },
  { key: '4.7.9.1', level: 'setup', section: 4, label: 'What conditions pause this setup, and what conditions retire it?', hint: 'Triggers written in advance', input: 'longtext' },
  { key: '4.7.9.2', level: 'setup', section: 4, label: 'What changed, when, and why?', hint: 'Version history. Each change links to the evidence that prompted it', input: 'longtext' },
]

// ---------- Section 4.8-4.13 · System risk & governance (per system) ----------
const S4_SYS2: PlanQuestion[] = [
  { key: '4.8.1', level: 'system', section: 4, label: 'What is the maximum risk per trade for any setup in this system?', hint: 'A percent and an amount. Setups may go lower, not higher', input: 'percent', rule: { type: 'hard', metric: 'risk_pct_per_trade' } },
  { key: '4.8.2', level: 'system', section: 4, label: 'What is the maximum number of trades per day, and of open positions?', hint: 'Numbers', input: 'table', rule: { type: 'hard', metric: 'trades_per_day' } },
  { key: '4.8.3', level: 'system', section: 4, label: 'What is the daily loss limit for this system?', hint: 'A percent and an amount', input: 'percent', rule: { type: 'hard', metric: 'daily_loss_limit' } },
  { key: '4.8.4', level: 'system', section: 4, label: 'What is the cap on correlated exposure inside this system?', hint: 'Ties to 4.3.7', input: 'text' },
  { key: '4.9.1', level: 'system', section: 4, label: 'What do I do between trades?', hint: 'Scanning, waiting, breaks', input: 'longtext' },
  { key: '4.9.2', level: 'system', section: 4, label: 'What are the stand-down triggers for this system?', hint: 'Consecutive losses, a set time, a volatility spike, a news event', input: 'list', checklistSource: true, rule: { type: 'hard', metric: 'no_trade_in_standdown' } },
  { key: '4.9.3', level: 'system', section: 4, label: 'How do I handle missed trades, slippage and technical failures?', hint: 'The response for each', input: 'longtext' },
  { key: '4.9.4', level: 'system', section: 4, label: 'What is forbidden once the session starts?', hint: 'For example, changing the rules mid-day', input: 'list' },
  { key: '4.10.1', level: 'system', section: 4, label: 'What must be recorded for every trade?', hint: 'Instrument, direction, account, entry and exit times, entry and exit prices, size, fees, initial stop and the time it was set, target, setup tag and grade, condition tag, screenshots, and an entry-time note', input: 'longtext', checklistSource: true, rule: { type: 'process', metric: 'entry_note_present' } },
  { key: '4.10.2', level: 'system', section: 4, label: 'How do I tag a trade so it can be assessed against this system?', hint: 'Tags, and whether the tag is set before entry or after close. The journal records which', input: 'text' },
  { key: '4.10.3', level: 'system', section: 4, label: 'What is reviewed for this system, how often, and by what measures?', hint: 'Feeds the review schedule in 7.4', input: 'longtext' },
  { key: '4.11.1', level: 'system', section: 4, label: 'What do I expect from the system as a whole, and in each market condition?', hint: 'Rolled up from the setups, and compared with 4.5.3', input: 'longtext' },
  { key: '4.11.2', level: 'system', section: 4, label: 'What is the current status of the edge claim?', hint: 'Hypothesis, being tested, validated or decaying, and the evidence', input: 'enum', options: ['hypothesis', 'being_tested', 'validated', 'decaying'] },
  { key: '4.11.3', level: 'system', section: 4, label: 'What are the system-level signs of decay, and which thresholds trigger a review?', hint: 'Metrics drifting, changes in market structure, crowding', input: 'longtext' },
  { key: '4.11.4', level: 'system', section: 4, label: 'What happens when a threshold is hit?', hint: 'The review, and the link to the pause and retire conditions in 4.12', input: 'longtext' },
  { key: '4.12.1', level: 'system', section: 4, label: 'What gates must be met to increase this system\u2019s size?', hint: 'System-specific gates. The plan-level gates are owned by 5.11', input: 'list' },
  { key: '4.12.2', level: 'system', section: 4, label: 'What conditions pause this system?', hint: 'Triggers written in advance', input: 'list' },
  { key: '4.12.3', level: 'system', section: 4, label: 'What conditions retire it?', hint: 'Triggers, linked to the disproof statements in 4.7.8.5', input: 'list' },
  { key: '4.12.4', level: 'system', section: 4, label: 'What do I do with its capital when it stops?', hint: 'Where the allocation goes', input: 'text' },
  { key: '4.13.1', level: 'system', section: 4, label: 'What changed in this system, when, and why?', hint: 'Each change links to the evidence that prompted it. Trades stay pinned to the version in force when they were linked', input: 'longtext' },
]

// ---------- Section 5 · Risk and Money Management (plan) ----------
const S5: PlanQuestion[] = [
  { key: '5.1.1', level: 'plan', section: 5, label: 'What is the total capital of this business, and how much is trading capital versus personal reserve?', hint: 'Amounts. Ties to 3.3.1', input: 'money' },
  { key: '5.1.2', level: 'plan', section: 5, label: 'How did I get this money?', hint: 'Savings, salary, loan, inheritance, investor, funded or prop account. Borrowed or needed money carries more pressure', input: 'text' },
  { key: '5.1.3', level: 'plan', section: 5, label: 'Is it true risk capital?', hint: 'What losing all of it would do to my life, and what losing half would do', input: 'longtext' },
  { key: '5.1.4', level: 'plan', section: 5, label: 'Where is it held?', hint: 'Accounts, brokers, currencies, whose name, and any prop-firm rules that apply', input: 'longtext' },
  { key: '5.2.1', level: 'plan', section: 5, label: 'What is my overall market risk?', hint: 'Price moving against me, gaps and liquidity, leverage and margin', input: 'longtext' },
  { key: '5.2.2', level: 'plan', section: 5, label: 'What about broker and hardware risk?', hint: 'Counterparty and fund safety, platform, internet, power, hardware, data. Detailed in 5.10', input: 'longtext' },
  { key: '5.2.3', level: 'plan', section: 5, label: 'What is my strategy risk?', hint: 'The risk that an edge fails or decays, summed across the systems from 4.11', input: 'longtext' },
  { key: '5.2.4', level: 'plan', section: 5, label: 'What other risks threaten the money?', hint: 'Execution (slippage, spreads, order errors), behavioral (my own rule breaking), personal and life (health, income loss, emergencies), business (rising costs, changing rules), regulatory and tax', input: 'longtext' },
  { key: '5.3.1', level: 'plan', section: 5, label: 'What is the maximum risk per trade across the whole plan?', hint: 'A percent and an amount', input: 'percent', rule: { type: 'hard', metric: 'risk_pct_per_trade' } },
  { key: '5.3.2', level: 'plan', section: 5, label: 'What are my daily, weekly and monthly loss limits?', hint: 'Three limits', input: 'table', rule: { type: 'hard', metric: 'daily_loss_limit' } },
  { key: '5.3.3', level: 'plan', section: 5, label: 'What are my drawdown tiers?', hint: 'A warning level, a reduce-size level, a stop-and-review level and a hard stop, each with its response. This turns "most funds stop trading at 50 percent" into numbers. The target is stated in 3.5.1', input: 'table' },
  { key: '5.3.4', level: 'plan', section: 5, label: 'What are the maximum total open risk and number of open positions across all systems?', hint: 'Numbers', input: 'table', rule: { type: 'hard', metric: 'open_risk_total' } },
  { key: '5.3.5', level: 'plan', section: 5, label: 'What is the cap on correlated exposure?', hint: 'Two systems both long the same currency are one risk, not two', input: 'text' },
  { key: '5.3.6', level: 'plan', section: 5, label: 'What leverage and margin usage am I allowed?', hint: 'Maximums', input: 'text' },
  { key: '5.3.7', level: 'plan', section: 5, label: 'How do I measure drawdown?', hint: 'From peak or from the start of the period, percent or currency, and whether open trades are included', input: 'text' },
  { key: '5.4.1', level: 'plan', section: 5, label: 'When will I stop trading for the day?', hint: 'The daily limit and stand-down triggers', input: 'longtext' },
  { key: '5.4.2', level: 'plan', section: 5, label: 'When will I stop trading for a period?', hint: 'The drawdown tiers and what each one pauses', input: 'longtext' },
  { key: '5.4.3', level: 'plan', section: 5, label: 'When will I stop trading altogether?', hint: 'The conditions in 5.11, and how I tell "walk away" from "bad patch"', input: 'longtext' },
  { key: '5.5.1', level: 'plan', section: 5, label: 'Large drawdowns: what will I do?', hint: 'The escalation steps in 5.9 and the recovery protocol in 5.11', input: 'longtext' },
  { key: '5.5.2', level: 'plan', section: 5, label: 'Large profits: what will I do?', hint: 'Decided in advance, because overconfidence, bigger size and relaxed rules often follow a great run. For example: withdraw a share, hold size steady, review the rules', input: 'longtext' },
  { key: '5.6.1', level: 'plan', section: 5, label: 'Which money management approaches will I use?', hint: 'Chosen from a list: fixed fractional, fixed ratio, fixed size, percent of equity, anti-martingale, with free text for others', input: 'enum', options: ['fixed_fractional', 'fixed_ratio', 'fixed_size', 'percent_of_equity', 'anti_martingale', 'other'] },
  { key: '5.6.2', level: 'plan', section: 5, label: 'Which approaches do I explicitly reject?', hint: 'For example, martingale', input: 'list' },
  { key: '5.6.3', level: 'plan', section: 5, label: 'Why does this approach fit my edge, capital and personality?', hint: 'The reasoning', input: 'longtext' },
  { key: '5.7.1', level: 'plan', section: 5, label: 'How will I determine my position size?', hint: 'The formula and the ceiling, based on the approach in 5.6. Each setup applies it in 4.7.5.6', input: 'longtext' },
  { key: '5.7.2', level: 'plan', section: 5, label: 'When must size shrink automatically?', hint: 'After drawdown tiers, during testing, in high volatility', input: 'list' },
  { key: '5.8.1', level: 'plan', section: 5, label: 'What does the business cost to run?', hint: 'The sum of each system\u2019s costs from 4.4.5, plus taxes and education', input: 'money' },
  { key: '5.8.2', level: 'plan', section: 5, label: 'What is the break-even point, and what is the runway?', hint: 'How long the business can survive a bad stretch', input: 'text' },
  { key: '5.8.3', level: 'plan', section: 5, label: 'What is the withdrawal policy?', hint: 'How much, how often, and under what conditions, for example only above a high-water mark', input: 'longtext' },
  { key: '5.8.4', level: 'plan', section: 5, label: 'What is the profit allocation?', hint: 'Reinvest, withdraw, build the reserve, pay tax', input: 'longtext' },
  { key: '5.8.5', level: 'plan', section: 5, label: 'What if I do not make enough to live on?', hint: 'The fallback, and the point at which I stop depending on the account', input: 'longtext' },
  { key: '5.8.6', level: 'plan', section: 5, label: 'What are my tax and record-keeping obligations?', hint: 'What is owed, when, and who handles it', input: 'text' },
  { key: '5.9.1', level: 'plan', section: 5, label: 'Which measures show that my money management is getting better?', hint: 'Drawdown depth and duration, consistency of risk per trade, limit breaches, risk-adjusted return, recovery time', input: 'list' },
  { key: '5.9.2', level: 'plan', section: 5, label: 'How often is this reviewed, and by whom or what?', hint: 'A schedule, linked to 7.4', input: 'text' },
  { key: '5.9.3', level: 'plan', section: 5, label: 'What counts as "improving", and over what period?', hint: 'A definition', input: 'text' },
  { key: '5.9.4', level: 'plan', section: 5, label: 'What is the escalation ladder if it is not improving?', hint: 'A fixed sequence, for example: review, reduce size, pause trading, external review, pivot or exit', input: 'list' },
  { key: '5.9.5', level: 'plan', section: 5, label: 'What triggers each step?', hint: 'Written in advance', input: 'list' },
  { key: '5.9.6', level: 'plan', section: 5, label: 'Who decides, and what stops me from deciding emotionally?', hint: 'A rule, a cooling-off period, or an accountability partner. The psychological steps are in 6.8', input: 'text' },
  { key: '5.10.1', level: 'plan', section: 5, label: 'What safeguards exist before anything goes wrong?', hint: 'Stops placed at the broker, size calculators, margin alerts', input: 'longtext' },
  { key: '5.10.2', level: 'plan', section: 5, label: 'What is the emergency procedure?', hint: 'How I flatten everything quickly, and who to call', input: 'longtext' },
  { key: '5.10.3', level: 'plan', section: 5, label: 'What backups exist?', hint: 'Backup broker, backup connection, and a record of positions kept outside the platform', input: 'longtext' },
  { key: '5.10.4', level: 'plan', section: 5, label: 'What is the infrastructure, and what is its backup?', hint: 'Hardware, internet, power, a second device. This belongs to me, not to a system', input: 'longtext' },
  { key: '5.10.5', level: 'plan', section: 5, label: 'Risk register — for each scenario (platform failure, broker problem, gap through a stop, power loss, fat-finger, losing streak, account compromised, illness, death, regulation change), what are the likelihood, impact, prevention and response?', hint: 'Prevention, backup route, and who or what closes the trade, written as steps and not as intentions', input: 'table' },
  { key: '5.11.1', level: 'plan', section: 5, label: 'What gates must be met before size increases?', hint: 'Sample size, drawdown inside limits, adherence rate, system stage. These are the phase gates in 3.9.2', input: 'list' },
  { key: '5.11.2', level: 'plan', section: 5, label: 'How big is each step, and how long must I stay at a level?', hint: 'Step size and minimum time', input: 'text' },
  { key: '5.11.3', level: 'plan', section: 5, label: 'What causes scaling down?', hint: 'Drawdown tiers, a rule-break streak, personal circumstances', input: 'list' },
  { key: '5.11.4', level: 'plan', section: 5, label: 'What conditions pause trading for a day, a week, or longer?', hint: 'Triggers', input: 'list' },
  { key: '5.11.5', level: 'plan', section: 5, label: 'What conditions mean a strategy is retired?', hint: 'The plan-level response to the decay and disproof triggers in 4.11 and 4.7.8', input: 'list' },
  { key: '5.11.6', level: 'plan', section: 5, label: 'What conditions mean I stop trading altogether?', hint: 'How I tell "walk away" from "bad patch"', input: 'longtext' },
  { key: '5.11.7', level: 'plan', section: 5, label: 'What happens to the capital in each case?', hint: 'Where it goes', input: 'longtext' },
  { key: '5.11.8', level: 'plan', section: 5, label: 'What is the pivot path?', hint: 'Change system, change market, return to learning, or reduce to a small-size mode', input: 'text' },
  { key: '5.11.9', level: 'plan', section: 5, label: 'What do I do after hitting a drawdown tier?', hint: 'Review, cooling-off period, demo or reduced-size return', input: 'list' },
  { key: '5.11.10', level: 'plan', section: 5, label: 'What must be true before I return to normal size?', hint: 'The same gates as scaling, applied again', input: 'list' },
  { key: '5.12.1', level: 'plan', section: 5, label: 'How is each limit above enforced?', hint: 'By structure (a broker-level limit, a size calculator, a locked platform), by commitment (written and reviewed), or by accountability (a partner or mentor who sees the numbers)', input: 'longtext' },
  { key: '5.12.2', level: 'plan', section: 5, label: 'Which rules rely on willpower alone?', hint: 'A list, and what replaces willpower for each', input: 'list' },
]

// ---------- Section 6 · Psychology (plan) ----------
const S6: PlanQuestion[] = [
  { key: '6.1.1', level: 'plan', section: 6, label: 'What is a loss to me?', hint: 'A cost of doing business, or a verdict on me', input: 'longtext' },
  { key: '6.1.2', level: 'plan', section: 6, label: 'What does it mean when price proves me wrong?', hint: 'My honest reading', input: 'longtext' },
  { key: '6.1.3', level: 'plan', section: 6, label: 'Can I act without knowing how this trade ends?', hint: 'My position on uncertainty', input: 'longtext' },
  { key: '6.1.4', level: 'plan', section: 6, label: 'What is my attitude towards risk?', hint: 'The belief, in my own words. Risk limits are in 5.3', input: 'longtext' },
  { key: '6.1.5', level: 'plan', section: 6, label: 'What does money mean to me, and what can my capital realistically produce, and how fast?', hint: 'An unrealistic answer here is a mindset problem written down as a goal', input: 'longtext' },
  { key: '6.1.6', level: 'plan', section: 6, label: 'What does a win say about me, and what do I do after one?', hint: 'My honest reading', input: 'longtext' },
  { key: '6.1.7', level: 'plan', section: 6, label: 'Do I judge myself on the quality of my decisions or on the result of each trade?', hint: 'One answer', input: 'text' },
  { key: '6.1.8', level: 'plan', section: 6, label: 'What can I control, and what can I not, about myself?', hint: 'The personal side of 2.3.2', input: 'longtext' },
  { key: '6.1.9', level: 'plan', section: 6, label: 'Is my self-worth connected to my results?', hint: 'Yes or no, and how', input: 'text' },
  { key: '6.1.10', level: 'plan', section: 6, label: 'Where did these beliefs come from?', hint: 'Upbringing, past trading, past losses, culture. The facts are in 1.5, and here they are interpreted', input: 'longtext' },
  { key: '6.1.11', level: 'plan', section: 6, label: 'What is my target mindset, and what is my current one?', hint: 'The gap, stated honestly', input: 'longtext' },
  { key: '6.1.12', level: 'plan', section: 6, label: 'Does my mindset contradict my plan?', hint: 'A direct check of beliefs against goals, sizing and rules', input: 'longtext' },
  { key: '6.1.13', level: 'plan', section: 6, label: 'What is my mindset statement?', hint: 'A short version I read before each session', input: 'text' },
  { key: '6.2.1', level: 'plan', section: 6, label: 'Which emotions show up, and when?', hint: 'Fear, greed, hope, regret, anger, frustration, euphoria, anxiety, boredom, FOMO, shame, overconfidence', input: 'list' },
  { key: '6.2.2', level: 'plan', section: 6, label: 'Which belief does each one defend?', hint: 'Each emotion mapped back to the mindset it protects', input: 'longtext' },
  { key: '6.2.3', level: 'plan', section: 6, label: 'What are my early warning signs?', hint: 'Body signals, thoughts and small behaviors', input: 'list' },
  { key: '6.2.4', level: 'plan', section: 6, label: 'How intense is too intense?', hint: 'A scale, and the level at which I step away', input: 'text' },
  { key: '6.2.5', level: 'plan', section: 6, label: 'What does my best state feel like?', hint: 'The target state, so I recognize it', input: 'text' },
  { key: '6.3.1', level: 'plan', section: 6, label: 'Which actions hurt me?', hint: 'Closing early, moving or removing a stop, revenge trading, oversizing, overtrading, chasing, averaging down, skipping the plan, hesitating on valid setups, skipping the journal', input: 'list' },
  { key: '6.3.2', level: 'plan', section: 6, label: 'What is the chain behind each action?', hint: 'Action, the emotion driving it, and the belief underneath', input: 'longtext' },
  { key: '6.3.3', level: 'plan', section: 6, label: 'What has each one cost me?', hint: 'Numbers from the journal, not impressions', input: 'longtext' },
  { key: '6.3.4', level: 'plan', section: 6, label: 'What is the replacement action?', hint: 'A specific behavior I do instead', input: 'list' },
  { key: '6.4.1', level: 'plan', section: 6, label: 'Which situations reliably set off emotion?', hint: 'After a loss, a losing streak, a large win, a missed trade, a stop-out followed by a reversal, boredom, news, drawdown, nearing a target, outside stress', input: 'list' },
  { key: '6.4.2', level: 'plan', section: 6, label: 'What does each trigger usually lead to?', hint: 'Linked to 6.2 and 6.3', input: 'longtext' },
  { key: '6.4.3', level: 'plan', section: 6, label: 'What is my rule for each?', hint: 'For example, after two losses, a mandatory pause', input: 'list' },
  { key: '6.5.1', level: 'plan', section: 6, label: 'What do I do before trading?', hint: 'The state check, my mindset statement, the stand-down criteria', input: 'longtext' },
  { key: '6.5.2', level: 'plan', section: 6, label: 'What do I do when a warning sign appears during trading?', hint: 'Pause, run the checklist, step away from the screen, reduce size, or close the platform', input: 'longtext' },
  { key: '6.5.3', level: 'plan', section: 6, label: 'What do I do afterwards?', hint: 'A debrief that traces each notable action back through emotion to mindset, without blame', input: 'longtext' },
  { key: '6.5.4', level: 'plan', section: 6, label: 'Which ongoing practices am I committing to?', hint: 'Journaling, reflection, coaching, therapy, training. The hours are owned by 8.4', input: 'list' },
  { key: '6.5.5', level: 'plan', section: 6, label: 'Who sees my numbers or knows my rules?', hint: 'A mentor, a trading partner or a professional', input: 'text' },
  { key: '6.6.1', level: 'plan', section: 6, label: 'What are my fit-to-trade criteria?', hint: 'Sleep, health, stress, mood, distractions, and a score below which I do not trade', input: 'list', checklistSource: true, rule: { type: 'process', metric: 'fit_to_trade' } },
  { key: '6.6.2', level: 'plan', section: 6, label: 'Which life events change my readiness?', hint: 'Bereavement, money problems, conflict, illness, and what the plan does in those periods', input: 'longtext' },
  { key: '6.6.3', level: 'plan', section: 6, label: 'What are the mental stand-down rules?', hint: 'When I stop for the day on mental grounds', input: 'list', checklistSource: true, rule: { type: 'hard', metric: 'no_trade_in_standdown' } },
  { key: '6.7.1', level: 'plan', section: 6, label: 'Which rules are most at risk from my psychology?', hint: 'Taken from the willpower-only list in 5.12.2', input: 'list' },
  { key: '6.7.2', level: 'plan', section: 6, label: 'What structure replaces willpower there?', hint: 'Broker limits, size calculators, locked platforms, accountability', input: 'list' },
  { key: '6.8.1', level: 'plan', section: 6, label: 'What do I log?', hint: 'Pre-trade state, emotions noted, and a short mindset note', input: 'text' },
  { key: '6.8.2', level: 'plan', section: 6, label: 'Which patterns do I review, and how often?', hint: 'The patterns and the schedule', input: 'text' },
  { key: '6.8.3', level: 'plan', section: 6, label: 'What counts as progress?', hint: 'Fewer harmful actions, shorter recovery after losses, more emotion felt without action', input: 'text' },
  { key: '6.8.4', level: 'plan', section: 6, label: 'What if it is not improving?', hint: 'Deeper reflection, outside help, reduced size, a pause. The escalation ladder is owned by 5.9', input: 'text' },
  { key: '6.8.5', level: 'plan', section: 6, label: 'How does my mindset change over time?', hint: 'A version history of the statement and what prompted each change', input: 'longtext' },
]

// ---------- Section 7 · Daily Operations (plan) ----------
const S7: PlanQuestion[] = [
  { key: '7.1.1', level: 'plan', section: 7, label: 'What is my daily pre-market routine?', hint: 'The ordered steps', input: 'list', checklistSource: true, rule: { type: 'process', metric: 'day_plan_before_first_trade' } },
  { key: '7.1.2', level: 'plan', section: 7, label: 'Have I analysed my last trades?', hint: 'A summary of recent trades, pulled from the journal', input: 'text' },
  { key: '7.1.3', level: 'plan', section: 7, label: 'Do I have any open positions?', hint: 'Pulled from the journal, with intended hold noted', input: 'text' },
  { key: '7.1.4', level: 'plan', section: 7, label: 'What are the general market conditions?', hint: 'A condition tag I choose, which the AI later compares with how the day went', input: 'text' },
  { key: '7.1.5', level: 'plan', section: 7, label: 'What will I do each day, hour by hour?', hint: 'The schedule template for the whole day', input: 'table' },
  { key: '7.1.6', level: 'plan', section: 7, label: 'Am I fit to trade today?', hint: 'Sleep, health, stress, mood, distractions, scored against the criteria in 6.6.1', input: 'text' },
  { key: '7.1.7', level: 'plan', section: 7, label: 'What is on the calendar?', hint: 'News events, data releases, holidays, session opens', input: 'text' },
  { key: '7.1.8', level: 'plan', section: 7, label: 'What is my map for today?', hint: 'Watchlist, key levels, and the scenarios I expect', input: 'longtext' },
  { key: '7.1.9', level: 'plan', section: 7, label: 'What is today\u2019s risk budget?', hint: 'Daily loss limit, maximum trades and size limits, pulled from 5.3 and 4.8', input: 'table', checklistSource: true },
  { key: '7.1.10', level: 'plan', section: 7, label: 'What makes me stand down today?', hint: 'Pulled from 4.9.2 and 6.6.3', input: 'list', checklistSource: true },
  { key: '7.1.11', level: 'plan', section: 7, label: 'Are my tools working?', hint: 'Connection, platform and data feed checked for each active system (4.4) before the open', input: 'list' },
  { key: '7.2.1', level: 'plan', section: 7, label: 'What is my session workflow?', hint: 'When I scan, wait, trade and take breaks', input: 'longtext' },
  { key: '7.2.2', level: 'plan', section: 7, label: 'What do I check at set times?', hint: 'Open risk, running profit and loss against limits, state check, news', input: 'list' },
  { key: '7.2.3', level: 'plan', section: 7, label: 'What do I record live?', hint: 'The entry-time note, the emotion tag, and any rule exception', input: 'list' },
  { key: '7.2.4', level: 'plan', section: 7, label: 'What do I do when the plan does not cover a situation?', hint: 'The default: stand aside and note it', input: 'text' },
  { key: '7.2.5', level: 'plan', section: 7, label: 'What ends the session?', hint: 'Time, limits, stand-down triggers', input: 'text' },
  { key: '7.3.1', level: 'plan', section: 7, label: 'Have I recorded today\u2019s trades?', hint: 'Every trade, as required by 4.10.1, including missed trades and trades I skipped on purpose', input: 'text' },
  { key: '7.3.2', level: 'plan', section: 7, label: 'Did I execute today\u2019s trades according to my plan?', hint: 'Each trade checked against its setup\u2019s rules, and the day against the day plan. Did I take any trade that matched no listed setup?', input: 'longtext' },
  { key: '7.3.3', level: 'plan', section: 7, label: 'Have I completed my trading journal?', hint: 'Notes, screenshots, emotions and a short mindset note', input: 'text', rule: { type: 'process', metric: 'journal_done_same_day' } },
  { key: '7.3.4', level: 'plan', section: 7, label: 'How did the day compare with the day plan?', hint: 'Which scenarios happened, and what I missed', input: 'longtext' },
  { key: '7.3.5', level: 'plan', section: 7, label: 'Did I keep the risk and money rules?', hint: 'Daily limit, size, open risk, and any tier crossed', input: 'text' },
  { key: '7.3.6', level: 'plan', section: 7, label: 'Is the day closed?', hint: 'Overnight positions are intended and noted, and tomorrow\u2019s calendar is glanced at', input: 'text' },
  { key: '7.3.7', level: 'plan', section: 7, label: 'What is today\u2019s scorecard?', hint: 'Adherence score, process score and emotion log, shown before the profit figure', input: 'text' },
  { key: '7.4.1', level: 'plan', section: 7, label: 'Weekly review — what does it cover?', hint: 'Patterns, setups, rule breaks, and the weekly goals in 3.2.3', input: 'longtext' },
  { key: '7.4.2', level: 'plan', section: 7, label: 'Monthly review — what does it cover?', hint: 'The goal ladder, drawdown tier, system health, and the monthly goals in 3.2.2', input: 'longtext' },
  { key: '7.4.3', level: 'plan', section: 7, label: 'Quarterly review — what does it cover?', hint: 'The whole plan and each system: edge decay checks, belief log, version changes, and the feasibility check in 3.11', input: 'longtext' },
]

// ---------- Section 8 · Discipline (plan) ----------
const S8: PlanQuestion[] = [
  { key: '8.1.1', level: 'plan', section: 8, label: 'What are my promises to myself?', hint: 'Short, specific commitments, for example "I will never move a stop against a trade" or "I will complete the journal before I close the platform"', input: 'list' },
  { key: '8.1.2', level: 'plan', section: 8, label: 'What happens when I break one?', hint: 'The consequence and the repair, decided in advance', input: 'longtext' },
  { key: '8.1.3', level: 'plan', section: 8, label: 'Who sees the promises?', hint: 'The accountability link', input: 'text' },
  { key: '8.2.1', level: 'plan', section: 8, label: 'What questions will I ask after a winning trade?', hint: 'My own list, including: Did I follow the plan, or did I get lucky? Was the size normal? Am I now feeling invincible? Would I take the next trade the same way?', input: 'list' },
  { key: '8.3.1', level: 'plan', section: 8, label: 'What questions will I ask after a losing trade?', hint: 'My own list, including: Was it a valid setup taken correctly (a good loss) or a rule break (a bad loss)? What was I feeling? Does the loss change anything about the plan, or is it normal variance? Am I fit to take the next trade?', input: 'list' },
  { key: '8.4.1', level: 'plan', section: 8, label: 'What steps will I take to improve my trading career?', hint: 'Skills to build, education, system development, psychological work, reviews, mentors', input: 'list' },
  { key: '8.4.2', level: 'plan', section: 8, label: 'How much time do I commit to each, and when?', hint: 'A yearly development plan with hours and dates', input: 'table' },
]

// ---------- Section 9 · Plan Governance (plan) ----------
const S9: PlanQuestion[] = [
  { key: '9.1.1', level: 'plan', section: 9, label: 'What is the version history of this plan?', hint: 'What changed, when, and why. Each change links to the evidence that prompted it', input: 'longtext' },
  { key: '9.1.2', level: 'plan', section: 9, label: 'Which parts are versioned separately?', hint: 'The plan, each system and each setup carry their own versions, so changing one setup does not create a new version of the whole plan', input: 'text' },
  { key: '9.2.1', level: 'plan', section: 9, label: 'When may I change a rule?', hint: 'Only outside trading hours and never in the middle of a drawdown tier, unless the change makes a rule stricter', input: 'text' },
  { key: '9.2.2', level: 'plan', section: 9, label: 'What evidence is required for a change?', hint: 'A review finding, a sample size, or a disproved belief', input: 'text' },
  { key: '9.2.3', level: 'plan', section: 9, label: 'Is there a cooling-off period before a change takes effect?', hint: 'A number of days, for loosening changes', input: 'number', unit: 'days' },
  { key: '9.2.4', level: 'plan', section: 9, label: 'How do I tell a legitimate change from rationalization?', hint: 'The test, written in advance. Ties to 3.11.3', input: 'longtext' },
  { key: '9.3.1', level: 'plan', section: 9, label: 'When is each section reviewed?', hint: 'Self Assessment and Philosophy slowly, and after life events. Objectives, Risk and Systems on the monthly and quarterly cycle in 7.4. Psychology and Discipline continuously', input: 'text' },
  { key: '9.3.2', level: 'plan', section: 9, label: 'Which events trigger an unscheduled review?', hint: 'A tier crossed, a decay threshold hit, a new broker or instrument, a life change', input: 'list' },
  { key: '9.4.1', level: 'plan', section: 9, label: 'Linking rules — how are trades linked to the plan?', hint: 'Links are manual (I choose the plan, system and setup; the AI judges the trade against what I chose). Scope is a check. Link time is recorded. Link changes are kept. Versions are pinned. Unlinked trades count. Setup tags follow the same timing rule', input: 'longtext' },
]

export const PLAN_QUESTIONS: PlanQuestion[] = [
  ...S1, ...S2, ...S3, ...S4_0, ...S4_SYS, ...S4_SETUP, ...S4_SYS2, ...S5, ...S6, ...S7, ...S8, ...S9,
]

export const QUESTIONS_BY_LEVEL: Record<PlanLevel, PlanQuestion[]> = {
  plan: PLAN_QUESTIONS.filter((q) => q.level === 'plan'),
  system: PLAN_QUESTIONS.filter((q) => q.level === 'system'),
  setup: PLAN_QUESTIONS.filter((q) => q.level === 'setup'),
}

export const QUESTIONS_BY_KEY: Record<string, PlanQuestion> = Object.fromEntries(
  PLAN_QUESTIONS.map((q) => [q.key, q]),
)

/** All hard/process rule metrics the registry declares (for engine wiring). */
export const RULE_METRICS: { metric: string; type: 'hard' | 'judgment' | 'process'; sourceKeys: string[] }[] = (() => {
  const map = new Map<string, { metric: string; type: 'hard' | 'judgment' | 'process'; sourceKeys: string[] }>()
  for (const q of PLAN_QUESTIONS) {
    if (!q.rule) continue
    const cur = map.get(q.rule.metric)
    if (cur) cur.sourceKeys.push(q.key)
    else map.set(q.rule.metric, { metric: q.rule.metric, type: q.rule.type, sourceKeys: [q.key] })
  }
  return Array.from(map.values())
})()
