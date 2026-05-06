/**
 * Reusable pagination control: prev / next + "Page X of Y · Showing N of M".
 *
 * Usage:
 *   <Pagination
 *     page={page} totalPages={totalPages} pageSize={20}
 *     totalItems={total} loadedCount={items.length}
 *     onPageChange={setPage}
 *   />
 */
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({
  page,
  totalPages,
  pageSize,
  totalItems,
  loadedCount,
  onPageChange,
  loading = false,
  testIdPrefix = 'pagination',
}) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-3 border-t">
      <p className="text-xs text-muted-foreground" data-testid={`${testIdPrefix}-summary`}>
        Page <span className="font-medium tabular-nums">{page}</span> of{' '}
        <span className="font-medium tabular-nums">{totalPages}</span>
        {typeof totalItems === 'number' && (
          <>
            {' '}&middot; Showing {loadedCount} of {totalItems}
          </>
        )}
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1 || loading}
          data-testid={`${testIdPrefix}-prev`}
        >
          <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages || loading}
          data-testid={`${testIdPrefix}-next`}
        >
          Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  );
}
