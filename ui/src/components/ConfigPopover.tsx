/**
 * Bouton config de la conversation : un petit engrenage dans l'en-tête du
 * chat, et un popover compact pour changer l'agent et le modèle du chat, le
 * modèle des tâches et celui du compagnon.
 *
 * Le popover vit dans un portail en position fixe : l'aside du chat est en
 * `overflow-hidden`, un panneau absolu serait rogné, et la bulle doit rester
 * bornée à la fenêtre. Les listes viennent du daemon (catalogue OpenChamber),
 * jamais d'une liste inventée côté UI.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchSupervisorConfig, saveSupervisorConfig } from '../lib/api';
import {
  customAgentHint, defaultModelLabel, groupModelsByProvider, modelLabelOf, prefValue, warningText,
} from '../lib/config';
import { useSupervisorStore } from '../store/supervisorStore';
import type {
  SupervisorConfig, SupervisorConfigWarning, SupervisorModelOption, SupervisorPrefs,
} from '../types';
import { GearIcon } from './Icons';

const WIDTH = 342;
const GAP = 8;
const MARGIN = 8;

const EMPTY_VALUES: SupervisorPrefs = {
  chatModel: null, chatAgent: null, taskModel: null, companionModel: null,
};

export function prefsToValues(config: SupervisorConfig): SupervisorPrefs {
  return { ...config.prefs };
}

function valuesToPayload(values: SupervisorPrefs): Record<string, string | null> {
  return {
    chatAgent: prefValue(values.chatAgent) || null,
    chatModel: prefValue(values.chatModel) || null,
    taskModel: prefValue(values.taskModel) || null,
    companionModel: prefValue(values.companionModel) || null,
  };
}

export function ModelSelect({
  testId,
  label,
  value,
  models,
  defaultLabel,
  onChange,
}: {
  testId: string;
  label: string;
  value: string;
  models: SupervisorModelOption[];
  defaultLabel: string;
  onChange: (next: string) => void;
}) {
  const groups = groupModelsByProvider(models);
  return (
    <label className="flex flex-col gap-[3px]">
      <span className="text-[10.5px] text-muted">{label}</span>
      <select
        data-testid={testId}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer rounded-[6px] border border-border bg-white px-[6px] py-[4px] text-[11.5px] text-text outline-none focus:border-[#c9cfc9]"
      >
        <option value="">{defaultLabel}</option>
        {groups.map(group => (
          <optgroup key={group.providerID} label={group.providerName}>
            {group.models.map(model => (
              <option key={model.ref} value={model.ref}>{model.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

/** Contenu du panneau, sans portail : testable en rendu statique. */
export function ConfigFields({
  config,
  values,
  warnings,
  onChange,
}: {
  config: SupervisorConfig;
  values: SupervisorPrefs;
  warnings: SupervisorConfigWarning[];
  onChange: (field: keyof SupervisorPrefs, value: string | null) => void;
}) {
  const chatDefault = defaultModelLabel(config.models, config.defaults.chatModel);
  const selectedAgent = prefValue(values.chatAgent);
  const hint = customAgentHint(selectedAgent || null, config.agents);
  return (
    <div className="flex flex-col gap-[11px]">
      <section className="flex flex-col gap-[7px]">
        <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted">Conversation</div>
        <label className="flex flex-col gap-[3px]">
          <span className="text-[10.5px] text-muted">Agent</span>
          <select
            data-testid="config-agent"
            aria-label="Agent du chat"
            value={selectedAgent}
            onChange={(e) => onChange('chatAgent', e.target.value || null)}
            className="w-full cursor-pointer rounded-[6px] border border-border bg-white px-[6px] py-[4px] text-[11.5px] text-text outline-none focus:border-[#c9cfc9]"
          >
            <option value="">{config.defaults.chatAgentLabel}</option>
            {config.agents.map(agent => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
        </label>
        {hint ? <p className="m-0 text-[10.5px] leading-[1.35] text-attend">{hint}</p> : null}
        <ModelSelect
          testId="config-chat-model"
          label="Modèle"
          value={prefValue(values.chatModel)}
          models={config.models}
          defaultLabel={chatDefault}
          onChange={(next) => onChange('chatModel', next || null)}
        />
      </section>

      <section className="flex flex-col gap-[7px] border-t border-border pt-[9px]">
        <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted">Tâches</div>
        <ModelSelect
          testId="config-task-model"
          label="Modèle des tâches lancées"
          value={prefValue(values.taskModel)}
          models={config.models}
          defaultLabel={config.defaults.taskModelLabel}
          onChange={(next) => onChange('taskModel', next || null)}
        />
      </section>

      <section className="flex flex-col gap-[7px] border-t border-border pt-[9px]">
        <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted">Compagnon</div>
        <ModelSelect
          testId="config-companion-model"
          label="Modèle des analyses du compagnon"
          value={prefValue(values.companionModel)}
          models={config.models}
          defaultLabel={config.defaults.companionModelLabel}
          onChange={(next) => onChange('companionModel', next || null)}
        />
      </section>

      {warnings.length ? (
        <div
          data-testid="config-warnings"
          role="status"
          className="rounded-[6px] bg-orange-soft px-[7px] py-[5px] text-[10.5px] leading-[1.4] text-attend"
        >
          {warnings.map(warning => <div key={`${warning.field}-${warning.value}`}>{warningText(warning)}</div>)}
        </div>
      ) : null}
    </div>
  );
}

/** État courant du chat pour l'infobulle du bouton : agent et modèle effectifs. */
export function configSummary(agent: string | null, modelName: string | null): string {
  const parts = [
    agent?.startsWith('superviseur-orchestrateur') ? 'orchestrateur' : (agent ?? 'orchestrateur'),
    modelLabelOf(modelName ? { name: modelName } : null) || 'modèle par défaut',
  ];
  return parts.join(' · ');
}

export function ConfigPopover() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [config, setConfig] = useState<SupervisorConfig | null>(null);
  const [values, setValues] = useState<SupervisorPrefs>(EMPTY_VALUES);
  const [warnings, setWarnings] = useState<SupervisorConfigWarning[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const state = useSupervisorStore((s) => s.state);
  const refresh = useSupervisorStore((s) => s.refresh);

  // rechargement à chaque ouverture : le catalogue a pu changer côté OpenChamber
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadError(null);
    setSaveError(null);
    setWarnings([]);
    void fetchSupervisorConfig()
      .then((next) => {
        if (cancelled) return;
        setConfig(next);
        setValues(prefsToValues(next));
        setWarnings(next.warnings ?? []);
      })
      .catch(() => { if (!cancelled) setLoadError('Catalogue indisponible. Le daemon répond-il ?'); });
    return () => { cancelled = true; };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const pop = popRef.current?.getBoundingClientRect();
      if (!anchor || !pop) return;
      const left = Math.min(
        Math.max(MARGIN, anchor.right - pop.width),
        window.innerWidth - pop.width - MARGIN,
      );
      let top = anchor.bottom + GAP;
      if (top + pop.height > window.innerHeight - MARGIN) {
        top = Math.max(MARGIN, anchor.top - pop.height - GAP);
      }
      setPos({ left, top });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, config, warnings.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const change = (field: keyof SupervisorPrefs, value: string | null) => {
    setValues(prev => ({ ...prev, [field]: value }));
    setWarnings([]);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveSupervisorConfig(valuesToPayload(values));
      setConfig(result.config);
      setValues(prefsToValues(result.config));
      setWarnings(result.warnings.length ? result.warnings : (result.config.warnings ?? []));
      if (result.applied.error) setSaveError(result.applied.error);
      // l'en-tête du chat relit le modèle effectif tout de suite
      void refresh();
      if (!result.warnings.length && !result.applied.error) setOpen(false);
    } catch {
      setSaveError('Enregistrement impossible. Le daemon répond-il ?');
    } finally {
      setSaving(false);
    }
  };

  const modelName = state?.model?.name ?? state?.model?.ref ?? null;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        data-testid="config-button"
        aria-label="Configurer le chat"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Configurer le chat (${configSummary(state?.agent ?? null, modelName)})`}
        onClick={() => setOpen(v => !v)}
        className="flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-transparent text-muted hover:bg-hover hover:text-text"
      >
        <GearIcon />
      </button>

      {open
        ? createPortal(
            <div
              ref={popRef}
              role="dialog"
              aria-label="Configuration du chat"
              style={{
                position: 'fixed',
                left: pos?.left ?? 0,
                top: pos?.top ?? 0,
                width: WIDTH,
                visibility: pos ? 'visible' : 'hidden',
              }}
              className="z-[200] flex max-h-[calc(100vh-16px)] flex-col rounded-[9px] border border-border bg-card px-[11px] py-[9px] text-left shadow-[0_8px_22px_rgba(0,0,0,.16)]"
            >
              <div className="mb-[7px] flex items-center justify-between gap-[8px]">
                <span className="text-[11.5px] font-semibold">Configuration du chat</span>
                <span className="text-[10px] text-placeholder">sans redémarrer la session</span>
              </div>

              {loadError ? (
                <div data-testid="config-load-error" className="text-[11px] leading-[1.4] text-danger">{loadError}</div>
              ) : !config ? (
                <div data-testid="config-loading" className="text-[11px] text-muted">Chargement du catalogue…</div>
              ) : (
                <div className="min-h-0 overflow-y-auto">
                  <ConfigFields
                    config={config}
                    values={values}
                    warnings={warnings}
                    onChange={change}
                  />
                </div>
              )}

              {saveError ? (
                <div data-testid="config-save-error" role="status" className="mt-[7px] rounded-[6px] bg-orange-soft px-[7px] py-[5px] text-[10.5px] leading-[1.4] text-attend">
                  {saveError}
                </div>
              ) : null}

              <div className="mt-[9px] flex items-center justify-end gap-[6px] border-t border-border pt-[8px]">
                <button
                  type="button"
                  data-testid="config-close"
                  onClick={() => setOpen(false)}
                  className="cursor-pointer rounded-[6px] px-[8px] py-[3px] text-[11px] text-muted hover:bg-hover hover:text-text"
                >
                  Fermer
                </button>
                <button
                  type="button"
                  data-testid="config-save"
                  disabled={!config || saving}
                  onClick={() => void save()}
                  className="cursor-pointer rounded-[6px] bg-green px-[9px] py-[3px] text-[11px] font-semibold text-white disabled:cursor-default disabled:opacity-50"
                >
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
