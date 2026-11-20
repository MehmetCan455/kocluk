import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import UnderlineExtension from '@tiptap/extension-underline';
import {
  Bold,
  Code,
  Heading2,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Underline,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { saveNote } from '@/db/repositories';
import { sanitizeHtml } from '@/lib/sanitize';

export const AUTOSAVE_DELAY_MS = 800;

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: 'Henüz kaydedilmedi',
  pending: 'Kaydediliyor…',
  saving: 'Kaydediliyor…',
  saved: 'Kaydedildi',
  error: 'Kaydedilemedi',
};

const savedAtFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

export interface NoteEditorProps {
  topicId: string;
  initialHtml: string;
  initialUpdatedAt?: string;
}

interface ToolbarButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-transparent text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-[var(--accent-soft)] text-[var(--accent)]',
      )}
    >
      {children}
    </button>
  );
}

function formatSavedAt(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : savedAtFormatter.format(date);
}

function normalizeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) {
    return '';
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? withScheme : null;
  } catch {
    return null;
  }
}

/**
 * TipTap editor with a debounced autosave. Every update snapshots HTML and
 * plain text, so an unmount (tab switch) can still flush the pending note
 * without reading a destroyed editor instance.
 */
export function NoteEditor({ topicId, initialHtml, initialUpdatedAt }: NoteEditorProps) {
  const [status, setStatus] = useState<SaveStatus>(initialHtml ? 'saved' : 'idle');
  const [savedAt, setSavedAt] = useState<string | undefined>(initialUpdatedAt);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  const pendingRef = useRef<{ html: string; text: string } | null>(null);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const flush = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const pending = pendingRef.current;
    if (!pending) {
      return;
    }
    pendingRef.current = null;

    if (mountedRef.current) {
      setStatus('saving');
    }

    try {
      await saveNote(topicId, pending.html, pending.text);
      if (mountedRef.current) {
        setSavedAt(new Date().toISOString());
        setStatus('saved');
      }
    } catch (caught: unknown) {
      console.error('Not kaydedilemedi', caught);
      // Keep the failed snapshot so a pagehide/unmount flush, the next edit or
      // the explicit retry button can try again. A newer edit already waiting
      // is newer than this snapshot and must win.
      if (pendingRef.current === null) {
        pendingRef.current = pending;
      }
      if (mountedRef.current) {
        setStatus('error');
      }
    }
  }, [topicId]);

  const scheduleSave = useCallback(
    (html: string, text: string) => {
      pendingRef.current = { html, text };
      setStatus('pending');
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, AUTOSAVE_DELAY_MS);
    },
    [flush],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
        underline: false,
        heading: { levels: [2, 3] },
      }),
      UnderlineExtension,
      Highlight,
      LinkExtension.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      }),
      Placeholder.configure({ placeholder: 'Konu notunu buraya yaz…' }),
    ],
    content: sanitizeHtml(initialHtml),
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class: 'tiptap',
        role: 'textbox',
        'aria-label': 'Konu notu',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      scheduleSave(currentEditor.getHTML(), currentEditor.getText());
    },
  });

  useEffect(() => {
    mountedRef.current = true;
    const onPageHide = () => {
      void flush();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      mountedRef.current = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) {
        void saveNote(topicId, pending.html, pending.text).catch((caught: unknown) => {
          console.error('Not kaydedilemedi', caught);
        });
      }
    };
  }, [flush, topicId]);

  function openLinkForm() {
    if (!editor) {
      return;
    }
    const current = editor.getAttributes('link').href;
    setLinkUrl(typeof current === 'string' ? current : '');
    setLinkError(null);
    setLinkOpen(true);
  }

  function submitLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) {
      return;
    }

    const href = normalizeHref(linkUrl);
    if (href === null) {
      setLinkError('Geçerli bir bağlantı adresi gir (https:// veya e-posta)');
      return;
    }

    if (href === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    setLinkOpen(false);
    setLinkError(null);
  }

  const savedLabel = formatSavedAt(savedAt);
  const toolbarDisabled = !editor;

  return (
    <div className="space-y-3">
      <div
        role="toolbar"
        aria-label="Not biçimlendirme"
        className="flex flex-wrap items-center gap-1 border-b border-line pb-2"
      >
        <ToolbarButton
          label="Kalın"
          active={editor?.isActive('bold')}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="İtalik"
          active={editor?.isActive('italic')}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Altı çizili"
          active={editor?.isActive('underline')}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
        >
          <Underline className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Başlık"
          active={editor?.isActive('heading', { level: 2 })}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Madde listesi"
          active={editor?.isActive('bulletList')}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Numaralı liste"
          active={editor?.isActive('orderedList')}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Alıntı"
          active={editor?.isActive('blockquote')}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <Quote className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Vurgu"
          active={editor?.isActive('highlight')}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().toggleHighlight().run()}
        >
          <Highlighter className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Satır içi kod"
          active={editor?.isActive('code')}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().toggleCode().run()}
        >
          <Code className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Bağlantı"
          active={editor?.isActive('link')}
          disabled={toolbarDisabled}
          onClick={openLinkForm}
        >
          <Link2 className="h-4 w-4" aria-hidden="true" />
        </ToolbarButton>
      </div>

      {linkOpen ? (
        <form
          onSubmit={submitLink}
          aria-label="Bağlantı ekle"
          className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-raised p-3"
        >
          <label className="min-w-0 flex-1 text-xs font-medium text-muted">
            Bağlantı adresi
            <input
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              aria-invalid={linkError ? true : undefined}
              placeholder="https://ornek.com"
              className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg"
              autoFocus
            />
          </label>
          <Button type="submit" size="sm">
            Uygula
          </Button>
          {editor?.isActive('link') ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                setLinkOpen(false);
              }}
            >
              Bağlantıyı kaldır
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setLinkOpen(false)}>
            Vazgeç
          </Button>
          {linkError ? (
            <p role="alert" className="w-full text-xs text-danger">
              {linkError}
            </p>
          ) : null}
        </form>
      ) : null}

      <div className="rounded-xl border border-line bg-canvas/60 px-3 py-2 transition-colors focus-within:border-[var(--accent)]">
        <EditorContent editor={editor} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-3">
          <p
            role="status"
            aria-live="polite"
            className={cn(
              'font-medium',
              status === 'error'
                ? 'text-danger'
                : status === 'saved'
                  ? 'text-success'
                  : 'text-muted',
            )}
          >
            {STATUS_TEXT[status]}
          </p>
          {status === 'error' ? (
            <Button variant="secondary" size="sm" onClick={() => void flush()}>
              Tekrar dene
            </Button>
          ) : null}
        </div>
        {savedLabel ? <p className="text-muted">Son kayıt: {savedLabel}</p> : null}
      </div>
    </div>
  );
}
