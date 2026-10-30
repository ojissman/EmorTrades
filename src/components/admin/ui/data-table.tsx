'use client'

/**
 * ADMIN DATA TABLE (ADMIN-2) — generic, server-paginated table with optional
 * column sorting. Rows never paginate client-side; the page owns the fetch.
 */

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Pagination, TableSkeleton, AdminEmptyState } from './primitives'

export interface AdminColumn<T> {
  key: string
  header: React.ReactNode
  render: (row: T) => React.ReactNode
  /** When provided, the header is a sort button wired to onSort. */
  sortable?: boolean
  /** Right-align numerics. */
  align?: 'left' | 'right'
  width?: string
}

export interface SortState {
  key: string
  dir: 'asc' | 'desc'
}

export function AdminDataTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  emptyTitle,
  emptyDescription,
  emptyAction,
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  sort,
  onSort,
  onRowClick,
  'aria-label': ariaLabel,
}: {
  columns: AdminColumn<T>[]
  rows: T[]
  loading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
  page?: number
  pageSize?: number
  total?: number
  onPage?: (p: number) => void
  onPageSize?: (s: number) => void
  sort?: SortState | null
  onSort?: (s: SortState) => void
  onRowClick?: (row: T) => void
  'aria-label'?: string
}) {
  const showPagination = onPage != null && page != null && pageSize != null && total != null
  return (
    <div className="a-card overflow-hidden">
      {loading ? (
        <TableSkeleton rows={pageSize && pageSize > 25 ? 10 : 8} cols={Math.min(columns.length, 7)} />
      ) : rows.length === 0 ? (
        <AdminEmptyState title={emptyTitle ?? 'Nothing here yet'} description={emptyDescription} action={emptyAction} />
      ) : (
        <>
          <div className="a-table-wrap">
            <table className="a-table" aria-label={ariaLabel}>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      style={{ width: c.width, textAlign: c.align === 'right' ? 'right' : 'left' }}
                    >
                      {c.sortable && onSort ? (
                        <button
                          className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-[var(--a-text-2)]"
                          onClick={() =>
                            onSort({
                              key: c.key,
                              dir: sort?.key === c.key && sort.dir === 'asc' ? 'desc' : 'asc',
                            })
                          }
                          aria-label={`Sort by ${String(c.header)}`}
                        >
                          {c.header}
                          {sort?.key === c.key ? (
                            sort.dir === 'asc' ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(onRowClick && 'cursor-pointer')}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((c) => (
                      <td key={c.key} style={{ textAlign: c.align === 'right' ? 'right' : 'left' }}>
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {showPagination && (
            <Pagination
              page={page!}
              pageSize={pageSize!}
              total={total!}
              onPage={onPage!}
              onPageSize={onPageSize}
            />
          )}
        </>
      )}
    </div>
  )
}
