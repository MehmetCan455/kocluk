import { useLiveQuery } from 'dexie-react-hooks';
import { Card } from '@/components/ui/Card';
import { getNote, listAttachments } from '@/db/repositories';
import { AttachmentList } from './AttachmentList';
import { NoteEditor } from './NoteEditor';

export interface NotesTabProps {
  topicId: string;
}

export function NotesTab({ topicId }: NotesTabProps) {
  // The query result carries its topic so a stale live-query value from the
  // previously opened topic is never rendered for the new one.
  const noteState = useLiveQuery(
    async () => ({ topicId, note: (await getNote(topicId)) ?? null }),
    [topicId],
  );
  const attachmentState = useLiveQuery(
    async () => ({ topicId, attachments: await listAttachments(topicId) }),
    [topicId],
  );

  if (
    !noteState ||
    noteState.topicId !== topicId ||
    !attachmentState ||
    attachmentState.topicId !== topicId
  ) {
    return (
      <p role="status" className="py-10 text-center text-sm text-muted">
        Notlar yükleniyor…
      </p>
    );
  }

  const { note } = noteState;
  const { attachments } = attachmentState;

  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-5">
        <NoteEditor
          topicId={topicId}
          initialHtml={note?.contentHtml ?? ''}
          initialUpdatedAt={note?.updatedAt}
        />
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Dosya ekleri</h2>
          <p className="text-sm text-muted">
            Konuyla ilgili görsel ve PDF dosyalarını buraya ekleyebilirsin.
          </p>
        </div>
        <AttachmentList topicId={topicId} attachments={attachments} />
      </Card>
    </div>
  );
}
