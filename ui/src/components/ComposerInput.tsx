import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  classifyAttachment,
  formatFileSize,
  prepareAttachment,
  type ComposerAttachment,
} from '../lib/attachments';
import {
  assignImageCitationNames,
  citationNamesInText,
  insertAttachmentCitations,
  renameFileForCitation,
  sanitizeAttachmentFilename,
} from '../lib/attachmentCitations';
import { cx } from '../lib/cx';

/**
 * Zone de saisie partagée par le chat du superviseur et le détail d'une carte.
 * Collage, glisser-déposer, sélection de fichiers, aperçus et retrait vivent
 * ici une seule fois : les deux écrans se comportent à l'identique.
 */

export const ATTACHMENT_ACCEPT = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
  'text/*', '.md', '.markdown', '.txt', '.log', '.csv', '.tsv', '.json',
  '.yaml', '.yml', '.toml', '.ini', '.xml', '.html', '.css', '.js', '.ts',
  '.tsx', '.jsx', '.py', '.sh', '.sql', '.diff', '.patch', '.svg',
].join(',');

function filesFromTransfer(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const direct = Array.from(data.files ?? []);
  if (direct.length) return direct;
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

function transferCarriesFiles(data: DataTransfer | null | undefined): boolean {
  if (!data) return false;
  if ((data.files?.length ?? 0) > 0) return true;
  return Array.from(data.types ?? []).some((type) => type.toLowerCase() === 'files');
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-full w-full">
      <path d="M12.4 6.2 7.1 11.5a2.2 2.2 0 0 0 3.1 3.1l5.6-5.6a3.7 3.7 0 0 0-5.2-5.2L4.9 9.5a5.2 5.2 0 0 0 7.4 7.4l4.3-4.3" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-[18px] w-[18px]">
      <path d="M5 2.5h6l4 4v11H5z" />
      <path d="M11 2.5v4h4" />
    </svg>
  );
}

export interface ComposerInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Entrée sans Maj : envoie (ou met en file) */
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  attachments: ComposerAttachment[];
  onAttachmentsChange: (next: ComposerAttachment[]) => void;
  /** Boutons de droite (Envoyer, Stop) */
  actions?: ReactNode;
  /** Ligne d'aide facultative sous le champ (état de la file, etc.) */
  footer?: ReactNode;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  textareaTestId?: string;
  minHeight?: number;
  maxHeight?: number;
  textareaClassName?: string;
  className?: string;
  ariaLabel?: string;
}

export function ComposerInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  attachments,
  onAttachmentsChange,
  actions,
  footer,
  textareaRef,
  textareaTestId,
  minHeight = 34,
  maxHeight = 120,
  textareaClassName,
  className,
  ariaLabel,
}: ComposerInputProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const attachmentsRef = useRef(attachments);
  const changeRef = useRef(onAttachmentsChange);
  const valueRef = useRef(value);
  const intakeQueue = useRef<Promise<void>>(Promise.resolve());
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [atMax, setAtMax] = useState(false);

  attachmentsRef.current = attachments;
  changeRef.current = onAttachmentsChange;
  valueRef.current = value;

  const applyAttachments = (next: ComposerAttachment[]) => {
    attachmentsRef.current = next;
    changeRef.current(next);
  };

  const applyDraft = (next: string) => {
    valueRef.current = next;
    onChange(next);
  };

  /**
   * Insère `[nom]` pour chaque pièce jointe, au curseur (ou en fin de texte
   * quand le champ n'a pas le focus), avec les espaces d'OpenChamber.
   */
  const insertCitations = (names: string[], leadingText = '') => {
    const ta = localRef.current;
    const current = ta?.value ?? valueRef.current;
    const focused = !!ta && document.activeElement === ta;
    const start = focused ? (ta.selectionStart ?? current.length) : current.length;
    const end = focused ? (ta.selectionEnd ?? start) : current.length;
    const result = insertAttachmentCitations(current, start, end, names, leadingText);
    if (!result) return;
    if (ta) ta.value = result.next;
    applyDraft(result.next);
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(result.caret, result.caret);
    requestAnimationFrame(() => {
      if (localRef.current === ta) ta.setSelectionRange(result.caret, result.caret);
    });
  };

  interface IntakeOptions {
    /** cite le fichier dans le brouillon (collage, dépôt) */
    cite?: boolean;
    /** texte que le presse-papiers portait avec les fichiers */
    leadingText?: string;
  }

  const intake = (files: File[], options: IntakeOptions = {}) => {
    if (!files.length || disabled) return;
    const list = Array.from(files);
    const entries = list.map((file) => ({ file, citeAfter: null as string | null }));

    if (options.cite) {
      const imageEntries = entries.filter((entry) => {
        const verdict = classifyAttachment(entry.file);
        return verdict.ok && verdict.mimeType.startsWith('image/');
      });
      const used = new Set([
        ...attachmentsRef.current.map((attachment) => attachment.name),
        ...citationNamesInText(valueRef.current),
      ]);
      const imageNames = assignImageCitationNames(imageEntries.map((entry) => entry.file), [...used]);
      imageEntries.forEach((entry, index) => {
        entry.file = renameFileForCitation(entry.file, imageNames[index]);
      });
      // les images sont citées tout de suite, leur nom est déjà décidé
      if (imageNames.length) insertCitations(imageNames, options.leadingText);
      // les autres fichiers gardent leur nom, cité une fois attaché
      for (const entry of entries) {
        if (imageEntries.includes(entry)) continue;
        const safe = sanitizeAttachmentFilename(entry.file.name) || 'fichier';
        if (safe !== entry.file.name) entry.file = renameFileForCitation(entry.file, safe);
        entry.citeAfter = safe;
      }
    }

    intakeQueue.current = intakeQueue.current.then(async () => {
      const added: ComposerAttachment[] = [];
      const citations: string[] = [];
      const errors: string[] = [];
      for (const entry of entries) {
        const result = await prepareAttachment(entry.file);
        if (result.ok) {
          added.push(result.attachment);
          if (entry.citeAfter) citations.push(entry.citeAfter);
        } else {
          errors.push(result.error);
        }
      }
      if (added.length) applyAttachments([...attachmentsRef.current, ...added]);
      if (citations.length) insertCitations(citations);
      setError(errors.length ? errors.join('\n') : null);
    });
  };

  const removeAttachment = (id: string) => {
    applyAttachments(attachmentsRef.current.filter((attachment) => attachment.id !== id));
    setError(null);
  };

  const setTextarea = (node: HTMLTextAreaElement | null) => {
    localRef.current = node;
    if (textareaRef) textareaRef.current = node;
  };

  useLayoutEffect(() => {
    const ta = localRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const natural = ta.scrollHeight + 1;
    const height = Math.max(minHeight, Math.min(natural, maxHeight));
    setAtMax(natural > maxHeight);
    ta.style.height = `${height}px`;
  }, [value, minHeight, maxHeight, attachments.length]);

  // Un fichier lâché à côté du composer ne doit pas remplacer la page par le
  // fichier (comportement natif du navigateur) : on neutralise la navigation,
  // sans rien attacher hors de la zone.
  useEffect(() => {
    const guard = (event: DragEvent) => {
      if (!transferCarriesFiles(event.dataTransfer)) return;
      event.preventDefault();
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);

  return (
    <div
      data-composer
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDragEnter={(e) => {
        if (!transferCarriesFiles(e.dataTransfer)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!transferCarriesFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!transferCarriesFiles(e.dataTransfer)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!transferCarriesFiles(e.dataTransfer)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        intake(filesFromTransfer(e.dataTransfer), { cite: true });
      }}
      className={cx('relative', className)}
    >
      {attachments.length ? (
        <div data-testid="composer-attachments" className="mb-[7px] flex flex-wrap gap-[6px]">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              data-attachment={attachment.name}
              className="flex max-w-[220px] items-center gap-[6px] rounded-[7px] border border-border bg-render py-[3px] pl-[3px] pr-[4px]"
            >
              {attachment.mimeType.startsWith('image/') ? (
                <img
                  src={attachment.dataUrl}
                  alt={`Aperçu de ${attachment.name}`}
                  className="h-[38px] w-[38px] shrink-0 rounded-[5px] object-cover"
                />
              ) : (
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[5px] bg-white text-muted">
                  <FileIcon />
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-[11.5px] leading-[1.3] text-text" title={attachment.name}>
                  {attachment.name}
                </span>
                <span className="block text-[10px] leading-[1.3] text-placeholder">
                  {formatFileSize(attachment.size) || 'fichier'}
                </span>
              </span>
              <button
                type="button"
                title="Retirer la pièce jointe"
                aria-label={`Retirer ${attachment.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeAttachment(attachment.id);
                }}
                className="shrink-0 cursor-pointer rounded-[4px] px-[3px] text-[14px] leading-none text-placeholder hover:bg-hover hover:text-danger"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <div data-testid="composer-attachment-error" role="alert" className="mb-[6px] whitespace-pre-line text-[11px] leading-[1.35] text-danger">
          {error}
        </div>
      ) : null}

      <div className="relative">
        <div className="flex items-end gap-[7px]">
          <button
            type="button"
            title="Joindre des fichiers"
            aria-label="Joindre des fichiers"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
            className="mb-[3px] flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] bg-transparent p-[4px] text-placeholder transition-colors hover:bg-hover hover:text-green disabled:cursor-default disabled:opacity-40"
          >
            <PaperclipIcon />
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              intake(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <textarea
            ref={setTextarea}
            data-testid={textareaTestId}
            rows={1}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            aria-label={ariaLabel}
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => {
              const files = filesFromTransfer(e.clipboardData);
              if (!files.length) return;
              e.preventDefault();
              intake(files, {
                cite: true,
                leadingText: e.clipboardData?.getData('text') ?? '',
              });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            className={cx(
              'min-w-0 flex-1 resize-none font-[inherit] outline-none placeholder:text-placeholder',
              atMax ? 'overflow-y-auto' : 'overflow-y-hidden',
              textareaClassName,
            )}
          />
          {actions}
        </div>

        {dragging ? (
          <div
            data-testid="composer-dropzone"
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[8px] border-2 border-dashed border-green bg-[#f2f9f2]/95 text-[11.5px] font-semibold text-green"
          >
            Dépose les fichiers ici
          </div>
        ) : null}
      </div>

      {footer}
    </div>
  );
}
