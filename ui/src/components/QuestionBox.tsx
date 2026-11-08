import { useState } from 'react';
import { cancelQuestion, replyForm } from '../lib/api';
import {
  buildAnswer,
  isOther,
  OTHER,
  otherWithoutText,
  selectOption,
  typeText,
  type AnswerState,
} from '../lib/answer';
import { cx } from '../lib/cx';
import { BTN_GHOST, BTN_GHOST_SELECTED, BTN_PRIMARY, INPUT } from '../lib/ui';
import type { FormField, PendingForm } from '../types';

interface Props {
  sessionId: string;
  form: PendingForm;
  /** intégré sous le titre de la section Questions du détail : pas de bord ni de marge haute */
  embedded?: boolean;
}

interface FieldProps {
  field: FormField;
  picked: string | string[] | undefined;
  text: string;
  onSelect: (value: string) => void;
  onText: (text: string) => void;
  onSubmit: () => void;
}

/**
 * Un champ du questionnaire : options, choix « Autre » et texte libre.
 * « Autre » est le choix qui porte le texte libre ; il s'active dès la frappe
 * et bloque la soumission tant qu'aucun texte n'est saisi.
 */
export function QuestionField({ field, picked, text, onSelect, onText, onSubmit }: FieldProps) {
  const multi = field.type === 'multiselect';
  const hasOptions = !!field.options?.length;
  const other = isOther(picked);
  const blocked = other && !text.trim();
  const qtext = field.description ?? field.title;
  return (
    <div>
      {field.description || field.title ? (
        <div className="mb-[8px] text-[14px] leading-[1.45]">{qtext}</div>
      ) : null}
      <div className="mb-[6px] flex flex-wrap items-center gap-[7px]">
        {field.options?.map((o) => {
          const selected = multi
            ? Array.isArray(picked) && picked.includes(o.value)
            : picked === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(o.value)}
              className={cx(
                selected ? BTN_GHOST_SELECTED : BTN_GHOST,
                selected ? 'hover:text-white' : 'hover:border-green hover:text-green',
              )}
            >
              {o.label}
            </button>
          );
        })}
        {hasOptions ? (
          <button
            type="button"
            data-testid="question-other"
            aria-pressed={other}
            onClick={() => onSelect(OTHER)}
            style={blocked ? { borderColor: 'var(--color-danger)' } : undefined}
            className={cx(
              other ? BTN_GHOST_SELECTED : BTN_GHOST,
              other ? 'hover:text-white' : 'hover:border-green hover:text-green',
            )}
          >
            Autre
          </button>
        ) : null}
        <input
          type="text"
          data-testid="question-free"
          aria-label="Texte libre, choix « Autre »"
          aria-invalid={blocked || undefined}
          value={text}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="… ou répond en texte libre"
          // couleur de bordure en style inline : deux utilitaires de bordure
          // (INPUT porte border-border) ne se départagent pas par l'ordre des classes
          style={
            blocked
              ? { borderColor: 'var(--color-danger)' }
              : other
                ? { borderColor: 'var(--color-green)' }
                : undefined
          }
          className={cx(INPUT, 'min-w-[200px] flex-[1_1_220px]')}
        />
      </div>
      {blocked ? (
        <div data-testid="question-other-missing" className="-mt-[4px] mb-[8px] text-[11.5px] text-danger">
          Saisis un texte pour « Autre », ou choisis une option.
        </div>
      ) : null}
    </div>
  );
}

/**
 * Questionnaire multi-champs : les options, le choix « Autre » et son champ de
 * texte cohabitent, un seul bouton « Répondre » envoie l'objet complet { qN: valeur }.
 */
export function QuestionBox({ sessionId, form, embedded = false }: Props) {
  const fields = form.fields ?? [];
  const [state, setState] = useState<AnswerState>({ choice: {}, free: {} });
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = buildAnswer(fields, state.choice, state.free);
  const blocked = otherWithoutText(fields, state.choice, state.free);
  const canSubmit = Object.keys(answer).length > 0 && blocked.length === 0;

  const submit = () => {
    if (sending || !canSubmit) return;
    setSending(true);
    setError(null);
    void replyForm(sessionId, form.id, answer)
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setSending(false));
  };

  const cancel = () => {
    if (sending || cancelling) return;
    const q = fields[0]?.description ?? fields[0]?.title ?? 'cette question';
    if (!window.confirm(`Annuler la question « ${q} » ? L'agent reprendra sans réponse.`)) return;
    setCancelling(true);
    setError(null);
    void cancelQuestion(sessionId, form.id)
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setCancelling(false));
  };

  return (
    <div className={cx(embedded ? 'mt-[6px]' : 'mt-[10px] border-t border-border pt-[10px]')}>
      {fields.map((f, i) => {
        const key = f.key ?? 'q0';
        const multi = f.type === 'multiselect';
        const hasOptions = !!f.options?.length;
        return (
          <QuestionField
            key={`${key}-${i}`}
            field={f}
            picked={state.choice[key]}
            text={state.free[key] ?? ''}
            onSelect={(value) => setState((s) => selectOption(s, key, value, multi))}
            onText={(text) => setState((s) => typeText(s, key, text, hasOptions))}
            onSubmit={submit}
          />
        );
      })}
      {error ? <div className="mb-[6px] text-[11.5px] text-danger">{error}</div> : null}
      <div className="mb-[4px] mt-[2px] flex justify-end gap-[7px]">
        <button
          type="button"
          onClick={cancel}
          disabled={sending || cancelling}
          className={cx(BTN_GHOST, 'text-muted', (sending || cancelling) && 'cursor-default opacity-40')}
        >
          Annuler la question
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={sending || !canSubmit}
          className={cx(BTN_PRIMARY, (sending || !canSubmit) && 'cursor-default opacity-40')}
        >
          Répondre
        </button>
      </div>
    </div>
  );
}
