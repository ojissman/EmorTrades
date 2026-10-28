'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AlertTriangle, RotateCcw, Home } from 'lucide-react'
import { useAppStore, HOME_ROUTE } from '@/store/app-store'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Page error:', error)
  }, [error])

  const { navigate } = useAppStore()

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-4">
      <Card className="p-6 md:p-8 max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-red-500/10 mb-4">
          <AlertTriangle className="h-7 w-7 text-red-400" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
        <p className="text-sm text-muted-foreground mb-1">
          {error.message || 'An unexpected error occurred while rendering this page.'}
        </p>
        {error.digest && (
          <p className="text-[10px] text-muted-foreground/50 mb-4 font-mono">
            Error ID: {error.digest}
          </p>
        )}
        <div className="flex items-center justify-center gap-2 mt-4">
          <Button variant="outline" onClick={() => navigate(HOME_ROUTE)}>
            <Home className="h-4 w-4 mr-1.5" />
            Overview
          </Button>
          <Button onClick={reset} className="bg-emerald-600 hover:bg-emerald-700">
            <RotateCcw className="h-4 w-4 mr-1.5" />
            Try again
          </Button>
        </div>
      </Card>
    </div>
  )
}
