'use client'

/**
 * PeakPopup (spec §1.5) — the shared anchored "peak view" popup used by the
 * Add/Import menu, the Custom Dashboards picker, the AI agent panel and the
 * apps launcher. Elevated surface + hairline border (§1.6), closes on
 * outside-click / Esc.
 */

import * as React from 'react'
import * as Popover from '@radix-ui/react-popover'

export const PeakPopup = Popover.Root
export const PeakPopupTrigger = Popover.Trigger

export function PeakPopupContent({
  children,
  className,
  align = 'start',
  sideOffset = 8,
  width,
}: {
  children: React.ReactNode
  className?: string
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  width?: number | string
}) {
  return (
    <Popover.Portal>
      <Popover.Content
        align={align}
        sideOffset={sideOffset}
        style={{ width }}
        className={
          'shell-pop z-[70] rounded-lg p-3 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 ' +
          (className ?? '')
        }
      >
        {children}
      </Popover.Content>
    </Popover.Portal>
  )
}

export const PeakPopupClose = Popover.Close
