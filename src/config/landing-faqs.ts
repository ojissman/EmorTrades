/**
 * LANDING FAQS (SEO-UPGRADE) — shared data module (no 'use client' — plain
 * data exported from client modules arrives in server components as opaque
 * client-reference proxies, not values). Used by: the landing FAQ section,
 * the public /faq page, and the home page's FAQPage JSON-LD so all three
 * render the exact same questions (Google's schema-mirrors-content rule).
 */

export const FAQS = [
  {
    q: 'Is my trading data private?',
    a: 'Yes — by architecture, not by policy. Every account lives in its own scoped slice of a single private database, and every API request is authenticated and user-scoped. There is no third-party analytics on your trades and your journal data never trains anyone\'s models.',
  },
  {
    q: 'Which markets and instruments are supported?',
    a: 'All of them: stocks, futures, forex, crypto and options. Any symbol you can type, with per-account currency, R-multiple tracking and commission handling built in.',
  },
  {
    q: 'Can I import my existing trade history?',
    a: 'Yes — CSV, Excel, XML, HTML tables and JSON are all parsed natively, with AI-assisted column mapping that learns your broker\'s export format. Most traders import years of history in their first sitting.',
  },
  {
    q: 'What does the AI actually see?',
    a: 'Only your journal — trades, plans, notes and metrics from your own account. The AI desk is grounded on that data when it writes reviews, briefings and insights. You can bring your own provider keys (OpenAI, Anthropic, GLM and more) or use the built-in model.',
  },
  {
    q: 'Is it free? What\'s the catch?',
    a: 'EmorTrades is free while in beta — every feature, every page, unlimited trades, no tiers and no credit card. Pricing will be announced before launch, and early accounts will be looked after.',
  },
  {
    q: 'Why do I need to verify my email?',
    a: 'It keeps the platform clean: verified accounts stop bots, throwaway actors and spam sign-ups from ever reaching your community. The link is valid for 24 hours — or skip it entirely by signing up with Google, which verifies your Gmail automatically.',
  },
]
