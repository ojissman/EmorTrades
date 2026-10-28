'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Sparkles,
  Send,
  TrendingUp,
  AlertTriangle,
  Target,
  Lightbulb,
  RefreshCw,
  Brain,
  MessageSquare,
  Activity,
  Shield,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { cn } from '@/lib/utils'

const PRESET_QUESTIONS = [
  'What is my biggest weakness as a trader?',
  'Which setup should I focus on most?',
  'When am I most profitable during the day?',
  'How can I improve my risk management?',
  'What patterns am I missing in my trading?',
  'Am I overtrading?',
]

const INSIGHT_KINDS = [
  { id: 'overview', label: 'Performance Overview', icon: Activity, desc: 'Comprehensive analysis of your trading performance' },
  { id: 'patterns', label: 'Pattern Recognition', icon: Lightbulb, desc: 'Hidden patterns and edges in your data' },
  { id: 'risk', label: 'Risk Assessment', icon: Shield, desc: 'Deep risk and money management analysis' },
]

export function AiPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [insights, setInsights] = useState<string>('')
  const [question, setQuestion] = useState('')
  const [activeKind, setActiveKind] = useState<string>('overview')

  async function generateInsights(kind: string = 'overview', q?: string) {
    setLoading(true)
    setError(null)
    setActiveKind(kind)
    try {
      const res = await fetch('/api/ai-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          question: q || question,
        }),
      })
      if (!res.ok) throw new Error('Failed to generate insights')
      const data = await res.json()
      setInsights(data.insights)
    } catch (e) {
      setError('Failed to generate insights. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function askQuestion(q?: string) {
    const questionToAsk = q || question
    if (!questionToAsk.trim()) return
    setQuestion(questionToAsk)
    await generateInsights('question', questionToAsk)
  }

  return (
    <div className="space-y-4">
      {/* Hero */}
      <Card className="p-5 md:p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-indigo-500/10 pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-lg bg-white/5 border border-[var(--border-strong)]">
              <Sparkles className="h-5 w-5 text-[var(--text-secondary)]" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                AI Trade Insights
                <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
                  POWERED BY GLM
                </Badge>
              </h2>
              <p className="text-xs text-muted-foreground">
                Get AI-powered analysis of your trading performance, patterns, and risk
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Insight types */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {INSIGHT_KINDS.map((kind) => {
          const Icon = kind.icon
          return (
            <Card
              key={kind.id}
              className={cn(
                'p-4 cursor-pointer transition-all hover:border-white/15 hover:bg-white/5',
                activeKind === kind.id && !loading && 'border-white/20 bg-white/5'
              )}
              onClick={() => generateInsights(kind.id)}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  'p-2 rounded-md',
                  activeKind === kind.id ? 'bg-white/10' : 'bg-muted/60'
                )}>
                  <Icon className={cn(
                    'h-4 w-4',
                    activeKind === kind.id ? 'text-foreground' : 'text-muted-foreground'
                  )} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold">{kind.label}</h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{kind.desc}</p>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* Custom question */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="h-4 w-4 text-emerald-400" />
          <h3 className="text-sm font-semibold">Ask a custom question</h3>
        </div>
        <div className="flex gap-2">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about your trading performance, patterns, or what to improve..."
            rows={2}
            className="resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                askQuestion()
              }
            }}
          />
          <Button
            onClick={() => askQuestion()}
            disabled={loading || !question.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 self-end"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {PRESET_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => askQuestion(q)}
              disabled={loading}
              className="text-xs px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-emerald-500/30 transition-colors disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      </Card>

      {/* Results */}
      {(loading || insights || error) && (
        <Card className="p-4 md:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-semibold">
                {loading ? 'Analyzing your trades...' : 'AI Analysis'}
              </h3>
              {!loading && insights && (
                <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
                  Generated just now
                </Badge>
              )}
            </div>
            {!loading && insights && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => generateInsights(activeKind)}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Regenerate
              </Button>
            )}
          </div>

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : error ? (
            <div className="text-sm text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown
                components={{
                  h1: ({ children }) => <h1 className="text-lg font-semibold tracking-tight mt-4 mb-2 text-foreground">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-base font-semibold tracking-tight mt-4 mb-2 text-foreground">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-1.5 text-foreground">{children}</h3>,
                  p: ({ children }) => <p className="text-sm leading-relaxed mb-3 text-muted-foreground">{children}</p>,
                  ul: ({ children }) => <ul className="text-sm space-y-1 mb-3 text-muted-foreground list-disc pl-5">{children}</ul>,
                  ol: ({ children }) => <ol className="text-sm space-y-1 mb-3 text-muted-foreground list-decimal pl-5">{children}</ol>,
                  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                  code: ({ children }) => <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-emerald-400">{children}</code>,
                  blockquote: ({ children }) => <blockquote className="border-l-2 border-emerald-500/40 pl-3 italic text-muted-foreground">{children}</blockquote>,
                }}
              >
                {insights}
              </ReactMarkdown>
            </div>
          )}
        </Card>
      )}

      {/* Feature description */}
      {!insights && !loading && (
        <Card className="p-6">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-yellow-400" />
            What can AI Insights do for you?
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-start gap-2.5 p-3 rounded-md bg-muted/40">
              <TrendingUp className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Performance Analysis</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Get a comprehensive breakdown of your trading strengths and weaknesses, with specific recommendations.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-3 rounded-md bg-muted/40">
              <Target className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Setup Optimization</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Identify which setups are working best for you and where to focus your attention.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-3 rounded-md bg-muted/40">
              <Activity className="h-4 w-4 text-purple-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Pattern Recognition</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Discover hidden patterns in your time-of-day, day-of-week, and symbol performance.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-3 rounded-md bg-muted/40">
              <Shield className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Risk Management</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Get specific recommendations on position sizing, risk-of-ruin, and drawdown management.
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
