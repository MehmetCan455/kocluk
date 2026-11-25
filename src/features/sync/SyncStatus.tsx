import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSyncOptional } from '@/app/SyncProvider';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/components/ui/cn';
import { getActiveDbOrNull } from '@/db/db';
import type { SyncIndicatorStatus, SyncState } from '@/db/sync/engine';
import {
  deadLetters,
  discardDeadLetter,
  retryDead,
} from '@/db/sync/queue';
import type { SyncQueueRow } from '@/domain/types';

/**
 * Sync indicator (design §9.5).
 *
 * The `bar` variant is the small top-bar icon; `panel` is the Settings
 * section with the last sync, pending/dead counts, the error message, the
 * manual trigger and the clock-skew warning. Both read the provider by
 * default; `state`/`onSyncNow` are test and preview seams.
 */

const CLOCK_SKEW_WARNING_MS = 5 * 60_000;

interface StatusPresentation {
  label: string;
  icon: LucideIcon;
  tone: string;
}

const STATUS: Record<SyncIndicatorStatus, StatusPresentation> = {
  synced: { label: 'Senkronize', icon: CheckCircle2, tone: 'text-success' },
  syncing: {
    label: 'Senkronize ediliyor…',
    icon: RefreshCw,
    tone: 'text-[var(--accent)]',
  },
  pending: { label: 'Bekleyen değişiklikler var', icon: Cloud, tone: 'text-warning' },
  offline: { label: 'Çevrimdışı', icon: CloudOff, tone: 'text-muted' },
  error: { label: 'Senkron hatası', icon: AlertTriangle, tone: 'text-danger' },
};

const lastSyncFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatLastSync(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : lastSyncFormatter.format(date);
}

/**
 * Skew is measured by the engine when `serverTime` arrives. A stored raw
 * `serverTime` is only a fallback for old metadata and test fixtures; it
 * drifts with the local clock, which is why the offset is preferred.
 */
export function syncClockSkewMs(
  state: Pick<SyncState, 'clockSkewMs' | 'serverTime'>,
): number | null {
  if (state.clockSkewMs !== null && Number.isFinite(state.clockSkewMs)) {
    return state.clockSkewMs;
  }
  if (state.serverTime !== null) {
    const parsed = Date.parse(state.serverTime);
    if (!Number.isNaN(parsed)) {
      return parsed - Date.now();
    }
  }
  return null;
}

export function syncClockSkewExceeded(
  state: Pick<SyncState, 'clockSkewMs' | 'serverTime'>,
): boolean {
  const skew = syncClockSkewMs(state);
  return skew !== null && Math.abs(skew) > CLOCK_SKEW_WARNING_MS;
}

export interface SyncStatusProps {
  variant?: 'bar' | 'panel';
  /** Test/preview override; defaults to the live sync context. */
  state?: SyncState;
  /** Test/preview override; defaults to the context's `syncNow`. */
  onSyncNow?: () => void;
}

export function SyncStatus({ variant = 'panel', state, onSyncNow }: SyncStatusProps) {
  const context = useSyncOptional();
  const sync = state ?? context;
  const [deadRows, setDeadRows] = useState<SyncQueueRow[]>([]);
  const [deadBusy, setDeadBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!sync || sync.dead === 0) {
      setDeadRows([]);
      return;
    }

    const database = getActiveDbOrNull();
    if (!database) {
      return;
    }

    let cancelled = false;
    void deadLetters(database)
      .then((rows) => {
        if (!cancelled) {
          setDeadRows(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDeadRows([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sync?.dead, sync?.status]);

  if (!sync) {
    return null;
  }

  const presentation = STATUS[sync.status];
  const Icon = presentation.icon;
  const syncing = sync.status === 'syncing';
  const skewExceeded = syncClockSkewExceeded(sync);
  const trigger = onSyncNow ?? context?.syncNow;

  async function retryOne(row: SyncQueueRow): Promise<void> {
    const database = getActiveDbOrNull();
    if (!database || deadBusy !== null) {
      return;
    }
    setDeadBusy(row.id);
    try {
      await retryDead(database, [row.id]);
      setDeadRows((rows) => rows.filter((entry) => entry.id !== row.id));
      await trigger?.();
    } finally {
      setDeadBusy(null);
    }
  }

  async function discardOne(row: SyncQueueRow): Promise<void> {
    const database = getActiveDbOrNull();
    if (!database || deadBusy !== null) {
      return;
    }
    setDeadBusy(row.id);
    try {
      await discardDeadLetter(database, row.id);
      setDeadRows((rows) => rows.filter((entry) => entry.id !== row.id));
      await trigger?.();
    } finally {
      setDeadBusy(null);
    }
  }

  if (variant === 'bar') {
    return (
      <Link
        to="/ayarlar"
        aria-label={`Senkron durumu: ${presentation.label}`}
        title={presentation.label}
        className="relative grid h-11 w-11 place-items-center rounded-xl transition-colors duration-150 hover:bg-raised"
      >
        <Icon
          className={cn(
            'h-5 w-5',
            presentation.tone,
            syncing ? 'animate-spin' : undefined,
          )}
          aria-hidden="true"
        />
        {sync.pending > 0 ? (
          <span className="absolute right-1 top-1 min-w-4 rounded-full bg-warning px-1 text-[10px] font-semibold leading-4 text-canvas">
            {sync.pending}
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Senkron</h2>
          <p className={cn('flex items-center gap-2 text-sm', presentation.tone)}>
            <Icon
              className={cn('h-4 w-4', syncing ? 'animate-spin' : undefined)}
              aria-hidden="true"
            />
            <span>{presentation.label}</span>
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void trigger?.();
          }}
          disabled={syncing}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Şimdi senkronize et
        </Button>
      </div>

      <div className="space-y-1 text-sm text-muted">
        <p>
          {sync.lastSyncAt
            ? `Son senkron: ${formatLastSync(sync.lastSyncAt)}`
            : 'Henüz senkronize edilmedi.'}
        </p>
        <p>Bekleyen kayıt: {sync.pending}</p>
        <p>Gönderilemeyen kayıt: {sync.dead}</p>
      </div>

      {sync.dead > 0 ? (
        <section
          aria-label="Gönderilemeyen kayıtlar"
          className="space-y-3 rounded-xl border border-danger/30 bg-danger/5 px-3 py-3"
        >
          <div className="space-y-1">
            <p className="text-sm font-semibold text-danger">Gönderilemeyen kayıtlar</p>
            <p className="text-sm text-muted">
              Bu değişiklikler sunucuya ulaşmadı. Tekrar deneyebilir veya yalnızca bu
              cihazdaki kaydı silebilirsin; silinen kayıt sunucudan yeniden gelebilir.
            </p>
          </div>

          {deadRows.length === 0 ? (
            <p role="status" className="text-sm text-muted">
              Kayıt ayrıntıları yükleniyor…
            </p>
          ) : (
            <ul className="space-y-2">
              {deadRows.map((row) => (
                <li
                  key={row.id}
                  className="space-y-2 rounded-lg border border-line bg-canvas px-3 py-2"
                >
                  <p className="text-sm font-medium">
                    {row.table} · {row.rowId}
                  </p>
                  {row.lastError ? (
                    <p className="break-words text-xs text-danger">{row.lastError}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void retryOne(row)}
                      disabled={deadBusy !== null}
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      Tekrar dene
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void discardOne(row)}
                      disabled={deadBusy !== null}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Yerel kaydı sil
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {sync.status === 'offline' ? (
        <p className="text-sm text-muted">
          İnternet bağlantısı gelince otomatik olarak yeniden denenecek.
        </p>
      ) : null}

      {sync.status === 'error' && sync.error ? (
        <p role="alert" className="text-sm text-danger">
          {sync.error}
        </p>
      ) : null}

      {skewExceeded ? (
        <div
          role="alert"
          className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          <p className="font-semibold">Cihaz saatinizi düzeltin</p>
          <p>
            Sunucu saatiyle bu cihazın saati arasında 5 dakikadan fazla fark var.
            Saat farkı, son yazan kazanır kuralını etkileyebilir.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
