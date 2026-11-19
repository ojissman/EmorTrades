'use client'

/**
 * ============================================================================
 * CONNECT-1 — one-time connector token display.
 * ============================================================================
 * The raw token ("emorta_" + 43 base62 chars, ~258 bits) exists in cleartext
 * exactly once per creation/rotation — the server stores only its sha256.
 * This box is therefore the ONLY place it can ever be seen: monospace,
 * click-to-select-all, copy button (clipboard API with the execCommand
 * fallback — the referrals-section copyText idiom), and the mandatory
 * "shown only once" warning. Used by both the create-success step and the
 * rotate-token dialog.
 */

import { useState } from 'react'
import { AlertTriangle, Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'

/** Clipboard with a hidden-textarea fallback for non-secure contexts. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    } catch {
      return false
    }
  }
}

export function TokenReveal({ token }: { token: string }) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  async function copy() {
    const ok = await copyText(token)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
      toast({ title: 'Token copied' })
    } else {
      toast({
        title: 'Copy failed',
        description: 'Select the token in the box and copy it manually (Ctrl/Cmd+C).',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-1.5" data-testid="connector-token-reveal">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs" htmlFor="connector-token">Connection token</Label>
        <Button type="button" size="sm" variant="outline" onClick={copy} data-testid="connector-token-copy">
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <Input
        id="connector-token"
        readOnly
        value={token}
        aria-label="Connection token (shown only once)"
        title="Click to select the whole token"
        className="font-mono text-xs cursor-pointer select-all"
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.currentTarget.select()}
      />
      <p className="text-xs flex items-start gap-1.5 text-amber-600 dark:text-amber-400" role="alert">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
        This token is shown only once — copy it now.
      </p>
    </div>
  )
}
