import { useId, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { PageChainView } from '@/db/pageChainRepository';
import type { WeeklyPlanRow } from './WeeklyPlanTable';

export interface PageChainBannerProps {
  chains: PageChainView[];
  rows: WeeklyPlanRow[];
  onAddNext: (chainId: string) => Promise<void>;
  onSkip: (chainId: string) => Promise<void>;
}

function rowLabelFor(rowId: string, rows: WeeklyPlanRow[]): string {
  const index = rows.findIndex((row) => row.id === rowId);
  if (index === -1) {
    return 'Plan satırı';
  }
  return rows[index].label.trim() || `${index + 1}. satır`;
}

/**
 * Tells the user which pages a missed chain day pushed out of the plan.
 * Incomplete chains are left out: their page math is unknown until the chain
 * is repaired, and appending a day would write a task the chain cannot account
 * for. The live region stays mounted so the warning is announced when it
 * appears after a tick.
 */
export function PageChainBanner({
  chains,
  rows,
  onAddNext,
  onSkip,
}: PageChainBannerProps) {
  const [adding, setAdding] = useState<string | null>(null);
  const [skipping, setSkipping] = useState<string | null>(null);
  const idPrefix = useId();

  const visible = chains.filter(
    (view) => !view.incomplete && view.unscheduled.length > 0,
  );

  async function addNext(chainId: string): Promise<void> {
    if (adding !== null || skipping !== null) {
      return;
    }
    setAdding(chainId);
    try {
      await onAddNext(chainId);
    } catch {
      // The plan owns the error message; the button must stay usable.
    } finally {
      setAdding(null);
    }
  }

  async function skip(chainId: string): Promise<void> {
    if (adding !== null || skipping !== null) {
      return;
    }
    setSkipping(chainId);
    try {
      await onSkip(chainId);
    } catch {
      // The plan owns the error message; the button must stay usable.
    } finally {
      setSkipping(null);
    }
  }

  return (
    <div aria-live="polite">
      {visible.length === 0 ? null : (
        <Card className="space-y-3 border-warning/40">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Planlanmamış sayfalar</h2>
            <p className="text-xs text-muted">
              Kaçırılan günlerin sayfaları zincirden düştü. Sonraki boş güne
              ekleyerek zinciri tamamla.
            </p>
            <p className="text-xs text-muted">
              Sil, yalnızca bu aralığı yok sayar; plandaki görevler silinmez.
            </p>
          </div>

          <ul className="divide-y divide-line rounded-xl border border-line bg-canvas">
            {visible.map((view) => {
              const label = rowLabelFor(view.chain.rowId, rows);
              const busy = adding !== null || skipping !== null;
              const addDisabled = view.nextEmptyDay === null || busy;
              const firstChunk = view.unscheduled[0];
              const rowDescriptionId = `${idPrefix}-row-${view.chain.id}`;
              const pagesDescriptionId = `${idPrefix}-pages-${view.chain.id}`;
              return (
                <li
                  key={view.chain.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0 space-y-1">
                    <p
                      id={rowDescriptionId}
                      className="truncate text-sm font-medium"
                      title={label}
                    >
                      {label}
                    </p>
                    <p
                      id={pagesDescriptionId}
                      className="flex flex-wrap gap-x-2 text-sm text-warning"
                    >
                      {view.unscheduled.map((chunk) => (
                        <span key={chunk.chunkIndex} className="tabular-nums">
                          {chunk.fromPage}–{chunk.toPage}
                        </span>
                      ))}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        onClick={() => void addNext(view.chain.id)}
                        disabled={addDisabled}
                        aria-describedby={`${rowDescriptionId} ${pagesDescriptionId}`}
                      >
                        Sonraki boş güne ekle
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => void skip(view.chain.id)}
                        disabled={busy}
                        aria-label={`${label} planlanmamış ${firstChunk.fromPage}–${firstChunk.toPage} aralığını sil`}
                        aria-describedby={`${rowDescriptionId} ${pagesDescriptionId}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Sil
                      </Button>
                    </div>
                    {view.nextEmptyDay === null ? (
                      <p className="text-xs text-muted">
                        Bu haftada boş gün kalmadı.
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
