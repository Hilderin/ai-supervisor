/** Icônes SVG de la maquette, plus les ajouts du chat (Stop, copier, revenir, balai). */
import type { ReactNode } from 'react';
import type { ActivityKind } from '../types';

export function OpenChamberIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}

export function PanelLeftIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3.4 20.4 20.8 12 3.4 3.6 3.3 10l12 2-12 2z" />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function RevertIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
    </svg>
  );
}

export function BroomIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m16 22-1-4" />
      <path d="M19 13.99a1 1 0 0 0 1-1V12a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v.99a1 1 0 0 0 1 1" />
      <path d="M5 14h14l1.973 6.767A1 1 0 0 1 20 22H4a1 1 0 0 1-.973-1.233z" />
      <path d="m8 22 1-4" />
    </svg>
  );
}

export function CloseConversationIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M6.6 6.6l10.8 10.8" />
    </svg>
  );
}

export function ChevronIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * Pastille « ? » orange : une question attend le propriétaire (carte et détail).
 * Remplace la main ✋, moins lisible et hors du langage visuel de la flotte.
 */
export function QuestionIcon({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-orange align-[-1px] font-bold leading-none text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.72) }}
    >
      ?
    </span>
  );
}

/**
 * Icônes de la ligne d'activité. Même langage qu'OpenChamber
 * (`toolPresentation.tsx` de son UI) : trait fin, 14 px, un pictogramme par
 * type (cerveau, crayon, fichier, loupe, terminal). Les composants d'OpenChamber
 * ne sont pas importables depuis ce dépôt : ce sont des équivalents dessinés
 * avec les mêmes métaphores, documentés dans activite-carte.md.
 */
function ActivitySvg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function ThinkingActivityIcon() {
  return (
    <ActivitySvg>
      <path d="M12 4.5a3 3 0 0 0-5.7-1.3A3 3 0 0 0 4 9.4a3 3 0 0 0 .7 4.9A3 3 0 0 0 9 20a3 3 0 0 0 3-2V4.5Z" />
      <path d="M12 4.5a3 3 0 0 1 5.7-1.3A3 3 0 0 1 20 9.4a3 3 0 0 1-.7 4.9A3 3 0 0 1 15 20a3 3 0 0 1-3-2V4.5Z" />
    </ActivitySvg>
  );
}

function WritingActivityIcon() {
  return (
    <ActivitySvg>
      <path d="M4 6h16M4 11h10M4 16h13M4 21h7" />
    </ActivitySvg>
  );
}

function ReadActivityIcon() {
  return (
    <ActivitySvg>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </ActivitySvg>
  );
}

function EditActivityIcon() {
  return (
    <ActivitySvg>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
      <path d="M14 6l4 4" />
    </ActivitySvg>
  );
}

function WriteActivityIcon() {
  return (
    <ActivitySvg>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </ActivitySvg>
  );
}

function SearchActivityIcon() {
  return (
    <ActivitySvg>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </ActivitySvg>
  );
}

function ShellActivityIcon() {
  return (
    <ActivitySvg>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </ActivitySvg>
  );
}

function ToolActivityIcon() {
  return (
    <ActivitySvg>
      <path d="M14.5 6.5a3.5 3.5 0 0 0 4.7 4.7l-7.7 7.7a2.3 2.3 0 0 1-3.2-3.2l7.7-7.7Z" />
      <path d="M14.5 6.5l3-3 3 3-3 3" />
    </ActivitySvg>
  );
}

export function ActivityIcon({ kind }: { kind: ActivityKind }) {
  if (kind === 'thinking') return <ThinkingActivityIcon />;
  if (kind === 'writing') return <WritingActivityIcon />;
  if (kind === 'read') return <ReadActivityIcon />;
  if (kind === 'edit') return <EditActivityIcon />;
  if (kind === 'write') return <WriteActivityIcon />;
  if (kind === 'search') return <SearchActivityIcon />;
  if (kind === 'shell') return <ShellActivityIcon />;
  return <ToolActivityIcon />;
}
