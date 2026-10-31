/**
 * SEO-UPGRADE seed — creates the starter blog categories + three real,
 * substantive articles (no keyword-stuffed filler). Idempotent: upserts by
 * slug, so re-running refreshes content only if a row is missing.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const CATEGORIES = [
  { name: 'Trading Psychology', slug: 'trading-psychology' },
  { name: 'Journaling Guides', slug: 'journaling-guides' },
  { name: 'Risk Management', slug: 'risk-management' },
]

interface SeedPost {
  slug: string
  title: string
  excerpt: string
  categorySlug: string
  tags: string
  featuredImage: string
  content: string
}

const POSTS: SeedPost[] = [
  {
    slug: 'why-trading-psychology-is-a-data-problem',
    title: 'Trading psychology is a data problem (you just haven\'t been measuring it)',
    excerpt:
      'Every trader knows psychology matters. Almost nobody measures it. Here is how to turn emotions, discipline and mistakes into numbers your journal can analyze — and what the patterns usually reveal.',
    categorySlug: 'trading-psychology',
    tags: 'psychology, discipline, behavior, journaling',
    featuredImage: '/blog/trading-psychology.png',
    content: `Ask a losing trader what went wrong and you will usually get a psychological answer: revenge trading, FOMO entries, moving stops. Ask the same trader to show you the **data** on those behaviors and the room goes quiet.

That silence is the actual problem. Psychology in trading is treated like weather — everyone talks about it, nobody instruments it. But if a behavior affects your P&L, it leaves a trail in your trade history, and anything that leaves a trail can be measured.

## The three measurements that matter

**1. Emotional state at entry.** Not a diary entry — a structured field. Before each trade, record two numbers: your emotional intensity (1–5) and your confidence (1–5). That's it. After fifty trades you can ask questions a spreadsheet can't answer: *does high-confidence entry correlate with better R-multiples, or is my confidence actually noise?* Traders are frequently wrong about this in both directions.

**2. Plan compliance, marked honestly.** Did the trade follow your written plan — entry reason, risk, size, exit? A simple yes/no per trade, scored by the rules, not by how the trade turned out. The uncomfortable finding for most traders: the compliance rate is lower than they believe, and **non-compliant trades cost more than compliant losers**. A compliant loss is tuition. A non-compliant loss is a leak.

**3. Mistake taxonomy.** Keep a fixed list of your personal recurring mistakes — revenge trade, oversized position, early exit, no-stop entry, overtrade after a win — and tag each trade with at most one. The point is not shame; it is frequency × cost. When you can see that one mistake cost 2.3R last month, behavior change stops being a vague intention and becomes a budget.

## What the data usually shows

In our experience building these tools, three patterns show up constantly:

- **Tilt has a signature.** Revenge trades cluster after losses, in the first 30 minutes after the loss, at larger-than-normal size. Once you see the cluster, you can write a rule for it — "no new position within 30 minutes of a full stop-out" — and measure whether the rule holds.
- **Win-streak overconfidence is real.** Average position size creeps up after three consecutive wins. Watch it happen in your own data and the effect loses its power.
- **Your best setups are fewer than you think.** Most traders make money on two or three setup types and bleed on the rest. Emotion data explains the bleed: the losing setups are usually the ones entered with high intensity and low conviction.

## The loop that actually works

Measurement changes nothing by itself. The loop is:

1. **Record** emotional state + compliance + mistakes per trade (30 seconds with the right tools).
2. **Review weekly**, not after every trade — per-trade review just adds emotional noise to the session.
3. **Write one rule** per review, targeting your most expensive measured mistake.
4. **Score the rule** the following week: did the behavior frequency drop?

One rule at a time, measured weekly, is unglamorous. It is also the only version of "trading psychology work" that has ever survived contact with a live market.

---

*Every measurement in this article is a built-in EmorTrades feature — per-trade emotion and confidence fields, plan-compliance marks, mistake tracking with cost analysis, and a behavior radar that profiles overtrading, revenge patterns and size discipline from your actual history. [Start your journal free](/#/register) and let the first fifty trades tell you what your gut has been hiding.*`,
  },
  {
    slug: 'how-to-start-a-trading-journal-that-survives-month-three',
    title: 'How to start a trading journal that survives month three',
    excerpt:
      'Most journals die within weeks — not from laziness, but from design. The minimum viable journal, the fields that matter, and the review cadence that keeps the habit alive.',
    categorySlug: 'journaling-guides',
    tags: 'journaling, workflow, review, beginners',
    featuredImage: '/blog/journaling-guide.png',
    content: `The graveyard of trading journals is enormous. Most traders start one, keep it faithfully for two or three weeks, and then quietly stop. The standard explanation is discipline — but that is usually wrong. Journals die from **design**: too many required fields, no payoff loop, and reviews that take longer than the trades.

Here is how to build one that survives.

## Start embarrassingly small

A journal entry needs exactly four things to be useful later:

1. **Instrument and direction** (long/short)
2. **Entry, exit, and size** — the numbers that compute P&L and R-multiples
3. **One sentence** on why you took the trade
4. **The date and time**

That is a complete minimum viable journal. Emotional state, screenshots, setup tags, plan links — all of that is valuable, but it is layer two. If layer one takes more than ninety seconds per trade, the journal dies. Add richness only when the habit is automatic.

The one-sentence "why" is the single most predictive field. Six months from now, it is the difference between a database and a diary.

## R-multiples or it didn't happen

Raw P&L lies. A $500 win on a $2,000 risk is a disaster; a $500 win on a $400 risk is excellent. Expressing results in **R** (multiples of initial risk) makes every trade comparable across instruments, sizes, and account phases — and it is the only way to answer the only question that matters: *when I risk one unit, how much do I get back?*

If your journal doesn't record initial risk, start recording it today, even for past trades where you must estimate.

## The review cadence that keeps the habit alive

Daily review of every trade is where journals go to die — it doubles the workload and triples the emotional load. Instead:

- **Per trade (30 seconds):** log the four fields. Done. Close the laptop.
- **Weekly (20 minutes):** the only real review. Win rate, average R, largest drawdown, and *one* question: what was my most expensive mistake this week?
- **Monthly (one hour):** look for structure — which setups, sessions, and instruments actually carry the P&L. Cut what bleeds.

The weekly session is the payoff loop that keeps the daily habit alive. If your journal can't produce a weekly summary automatically, you will eventually stop making one — this is the actual reason to use software instead of a spreadsheet.

## Make your history a one-click import

Nothing kills journal momentum like manual back-entry. Your broker already has your trades — export them (CSV, Excel, whatever format your platform offers) and import them in one pass. A journal with two years of history on day one gets taken seriously; an empty one gets abandoned.

## The honest checklist

Before you call it a journal, it should be able to answer:

- What is my win rate and average R over the last 50 trades?
- Which setup makes the most money? Which one loses the most?
- What did my last five non-compliant trades cost me?
- What does my equity curve look like with my worst three days removed?

If your tool can't answer all four in under a minute, it is a notebook, not a journal.

---

*EmorTrades was built around this loop: 90-second entry, six-format broker import with AI column mapping, automatic weekly summaries, and analytics that answer the checklist questions on one screen. [Try it free](/#/register) — your future self keeps the score.*`,
  },
  {
    slug: 'risk-management-rules-every-journal-should-measure',
    title: 'Five risk-management rules every journal should measure',
    excerpt:
      'Position sizing, daily loss limits, correlation caps, drawdown circuit-breakers — rules are easy to write and hard to follow. The difference between the two is measurement.',
    categorySlug: 'risk-management',
    tags: 'risk management, position sizing, drawdown, rules',
    featuredImage: '/blog/risk-management.png',
    content: `Every trader has risk rules. The good ones have risk rules they can prove they follow. The difference is not willpower — it is measurement. A rule your journal cannot score is a wish, and the market has a long history of exposing wishes.

Here are the five rules worth codifying, and what each one looks like as data.

## 1. Fixed fractional position sizing

The rule: risk a fixed fraction of equity per trade — commonly 0.5–2% — with size computed *before* entry, from stop distance.

The measurement: for every trade, compute "risk ÷ equity at entry". Not "what I planned to risk" — what the numbers say you risked. The distribution should be a spike, not a smudge. A smudge means sizing is being adjusted by feel, and feel correlates with recent wins far more than traders expect.

## 2. The daily loss limit

The rule: a hard stop for the day at a defined loss (e.g., 3R or 2% of equity). Not "I'll see how I feel" — a number.

The measurement: count the days that breached the limit *and kept trading after breach*. That count is your discipline score for the year. Every additional post-breach trade is measurable damage, and the data is brutal: post-breach trades, on average, lose several multiples of what they recover. The market does not reward the comeback attempt.

## 3. The correlation cap

The rule: total open risk across correlated positions is capped (e.g., max 3% combined on correlated instruments).

The measurement: your journal should be able to show open risk *at any past moment* — including the overlap. Traders discover their real drawdowns came not from single trades but from three "separate" 1% positions that were all the same trade wearing different symbols.

## 4. The drawdown circuit-breaker

The rule: at a defined drawdown from equity peak (e.g., 10%), size cuts in half; at a deeper level (e.g., 15%), trading pauses for a defined cooling-off period.

The measurement: equity curve with the circuit-breaker levels drawn. The question worth answering honestly: during my last real drawdown, did I follow my own de-risking plan, or did I hold size and "trade harder"? Most traders know the answer before they look. Look anyway — the gap between belief and data is exactly the size of the eventual blow-up.

## 5. The post-loss pause

The rule: no new position within a defined window after a full stop-out (e.g., 30 minutes, or one full market session for larger losses).

The measurement: tag every trade with time-since-last-loss. Compare average R for trades inside the pause window versus outside it. This is the single most convincing chart in behavioral trading: the same trader, the same setups — and the trades entered minutes after a loss perform dramatically worse. You do not need discipline to respect a pause once you have seen your own number.

## Rules are programs, not promises

Notice what all five have in common: each one converts a feeling ("I should probably trade smaller after a loss") into a computable condition. That conversion is the entire job. Once the condition is computable, your journal scores every trade green or red against it, the weekly review shows your compliance rate, and improvement becomes an engineering problem instead of a character problem.

Character is a fine thing. Engineering is more reliable.

---

*EmorTrades ships all five as measurable features: R-multiple tracking, risk-per-trade analytics, drawdown analysis with circuit-breaker levels, prop-firm compliance monitoring, and post-loss behavior profiling. [Start measuring free](/#/register).*`,
  },
]

async function main() {
  const catBySlug = new Map<string, string>()
  for (const c of CATEGORIES) {
    const row = await db.blogCategory.upsert({
      where: { slug: c.slug },
      update: { name: c.name },
      create: c,
    })
    catBySlug.set(c.slug, row.id)
  }
  console.log(`categories: ${CATEGORIES.length} ensured`)

  const admin = await db.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true, name: true, email: true },
  })
  const authorName = admin?.name?.trim() || 'EmorTrades Team'

  for (const p of POSTS) {
    const existing = await db.blogPost.findUnique({ where: { slug: p.slug }, select: { id: true } })
    if (existing) {
      console.log(`post "${p.slug}" already present — skipped`)
      continue
    }
    await db.blogPost.create({
      data: {
        slug: p.slug,
        title: p.title,
        excerpt: p.excerpt,
        content: p.content,
        status: 'PUBLISHED',
        categoryId: catBySlug.get(p.categorySlug) ?? null,
        tags: p.tags,
        authorId: admin?.id ?? null,
        authorName,
        authorTitle: 'EmorTrades',
        featuredImage: p.featuredImage,
        publishedAt: new Date(),
      },
    })
    console.log(`post "${p.slug}" created (PUBLISHED)`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
