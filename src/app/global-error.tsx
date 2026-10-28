'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Global error:', error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, backgroundColor: '#0a0e1a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem' }}>
          <div style={{ textAlign: 'center', maxWidth: '400px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '56px', width: '56px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.1)', marginBottom: '16px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '8px' }}>Application Error</h2>
            <p style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '16px' }}>
              {error.message || 'A critical error occurred. Please try refreshing the page.'}
            </p>
            {error.digest && (
              <p style={{ fontSize: '0.625rem', color: 'rgba(148, 163, 184, 0.5)', marginBottom: '16px', fontFamily: 'monospace' }}>
                Error ID: {error.digest}
              </p>
            )}
            <button
              onClick={reset}
              style={{
                backgroundColor: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '8px 20px',
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
