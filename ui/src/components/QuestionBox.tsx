import { useState } from 'react';
import { replyForm } from '../lib/api';
import { buildAnswer, type Choice } from '../lib/answer';
import { cx } from '../lib/cx';
import { BTN_GHOST, BTN_GHOST_SELECTED, BTN_PRIMARY, INPUT } from '../lib/ui';
import type { PendingForm } from '../types';

interface Props {
  sessionId: string;
  form: PendingForm;
}

/**
 * Questionnaire multi-champs : les options et le champ libre cohabitent,
 * un seul bouton « Répondre » envoie l'objet complet { qN: valeur }.
 */
export function QuestionBox({ sessionId, form }: Props) {
  const fields = form.fields ?? [];
  const [choice, setChoice] = useState<Choice>({});
  const [free, setFree] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  const toggle = (key: string, value: string, multi: boolean) => {
    setChoice((prev) => {
      if (!multi) return { ...prev, [key]: value };
      const cur = Array.isArray(prev[key]) ? (prev[key] as string[]) : [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...prev, [key]: next };
    });
  };

  const submit = () => {
    if (sending) return;
    const answer = buildAnswer(fields, choice, free);
    if (!Object.keys(answer).length) return;
    setSending(true);
    void replyForm(sessionId, form.id, answer)
      .catch((e) => console.error('[replyForm]', e))
      .finally(() => setSending(false));
  };

  return (
    <div className="mt-[10px] border-t border-border pt-[10px]">
      {fields.map((f, i) => {
        const key = f.key ?? 'q0';
        const multi = f.type === 'multiselect';
        const picked = choice[key];
        const qtext = f.description ?? f.title;
        return (
          <div key={`${key}-${i}`}>
            {f.description || f.title ? (
              <div className="mb-[8px] text-[14px] leading-[1.45]">{qtext}</div>
            ) : null}
            <div className="mb-[14px] flex flex-wrap items-center gap-[7px]">
              {f.options?.map((o) => {
                const selected = multi
                  ? Array.isArray(picked) && picked.includes(o.value)
                  : picked === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(key, o.value, multi)}
                    className={cx(
                      selected ? BTN_GHOST_SELECTED : BTN_GHOST,
                      selected ? 'hover:text-white' : 'hover:border-green hover:text-green',
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
              <input
                type="text"
                value={free[key] ?? ''}
                onChange={(e) => setFree((prev) => ({ ...prev, [key]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="… ou répond en texte libre"
                className={cx(INPUT, 'min-w-[200px] flex-[1_1_220px]')}
              />
            </div>
          </div>
        );
      })}
      <div className="mb-[4px] mt-[2px] flex justify-end gap-[7px]">
        <button type="button" onClick={submit} disabled={sending} className={BTN_PRIMARY}>
          Répondre
        </button>
      </div>
    </div>
  );
}
