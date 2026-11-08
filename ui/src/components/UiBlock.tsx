/**
 * Rendu des blocs `openui-lang` d'un message d'agent.
 *
 * Le parseur et le catalogue sont ceux d'OpenChamber (`ui/src/openui`), donc
 * les règles d'écriture sont les mêmes que dans son chat. Le rendu ne couvre
 * qu'un sous-ensemble utile au Superviseur : structure, étapes, tableau,
 * encadré, chiffres. Tout autre composant, un bloc invalide ou un bloc encore
 * partiel retombe en code brut : rien ne disparaît, et le fil ne casse pas
 * pendant le streaming.
 */
import { Component, isValidElement, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { blockNode, blockProps, parseUiBlock, tones, type BlockValue } from '../openui/catalog';
import { DeliveryImage } from './DeliveryImage';

type Tone = (typeof tones)[number];

const SUPPORTED = new Set([
  'Stack', 'Row', 'Card', 'Text', 'Badge', 'Callout', 'Table', 'Steps', 'Stat', 'Progress', 'KeyValue',
]);

const toneText: Record<Tone, string> = {
  neutral: 'text-muted',
  info: 'text-muted',
  success: 'text-green',
  warning: 'text-attend',
  error: 'text-danger',
};

const toneBox: Record<Tone, string> = {
  neutral: 'border-border bg-render',
  info: 'border-border bg-render',
  success: 'border-[#cfe7da] bg-green-soft',
  warning: 'border-wait-border bg-orange-soft',
  error: 'border-[#e7b9b9] bg-[#fbeeee]',
};

const toneBadge: Record<Tone, string> = {
  neutral: 'border-border bg-render text-muted',
  info: 'border-border bg-render text-muted',
  success: 'border-[#cfe7da] bg-green-soft text-green',
  warning: 'border-wait-border bg-orange-soft text-attend',
  error: 'border-[#e7b9b9] bg-[#fbeeee] text-danger',
};

/* ------------------------------------------------------------------ */
/* Markdown interne des blocs                                          */
/* ------------------------------------------------------------------ */

const linkAndTable: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="delivery-table">
      <table>{children}</table>
    </div>
  ),
};

function BlockMarkdown({ source, sessionId }: { source?: string; sessionId?: string }) {
  if (!source) return null;
  return (
    <div className="ui-block-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          ...linkAndTable,
          img: sessionId
            ? ({ src, alt }) => <DeliveryImage src={src} alt={alt} sessionId={sessionId} />
            : () => null,
        }}
      >
        {source}
      </Markdown>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Formats partagés avec OpenChamber                                   */
/* ------------------------------------------------------------------ */

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 });
const formatNumber = (value: number) => numberFormat.format(value).replace(/,/g, ' ');
const display = (value: string | number) => (typeof value === 'number' ? formatNumber(value) : String(value));

const tableCell = (cell: string | number | undefined) => (cell === undefined ? ''
  : typeof cell === 'number'
    ? display(cell)
    : String(cell).replace(/(\\*)\|/g, (match, slashes: string) => (slashes.length % 2 ? match : `${slashes}\\|`)).replace(/\r?\n/g, ' '));

/* ------------------------------------------------------------------ */
/* Composants                                                          */
/* ------------------------------------------------------------------ */

function propsOf<S>(schema: { safeParse: (value: unknown) => { success: boolean; data?: S } }, props: unknown): S | null {
  const parsed = schema.safeParse(props);
  return parsed.success ? parsed.data as S : null;
}

function TextNode({ props, sessionId }: { props: unknown; sessionId?: string }) {
  const value = propsOf<{ markdown: string }>(blockProps.Text, props);
  return value ? <BlockMarkdown source={value.markdown} sessionId={sessionId} /> : null;
}

function BadgeNode({ props }: { props: unknown }) {
  const value = propsOf<{ label: string; tone?: Tone }>(blockProps.Badge, props);
  if (!value) return null;
  const tone = value.tone ?? 'neutral';
  return (
    <span className={`w-fit rounded-full border px-[7px] py-[1px] text-[10.5px] font-medium ${toneBadge[tone]}`}>
      {value.label}
    </span>
  );
}

function CalloutIcon({ tone }: { tone: Tone }) {
  if (tone === 'success') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12.5 2.5 2.5 4.5-5" />
      </svg>
    );
  }
  if (tone === 'warning' || tone === 'error') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3 2.5 20h19L12 3Z" />
        <path d="M12 9v5M12 17.5v.5" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </svg>
  );
}

function CalloutNode({ props, sessionId }: { props: unknown; sessionId?: string }) {
  const value = propsOf<{ markdown: string; tone?: Tone; title?: string }>(blockProps.Callout, props);
  if (!value) return null;
  const tone = value.tone ?? 'neutral';
  const banner = tone === 'error' || tone === 'warning';
  return (
    <div
      data-tone={tone}
      className={`flex gap-[7px] ${banner ? `rounded-[8px] border px-[9px] py-[7px] ${toneBox[tone]}` : 'px-[2px]'}`}
    >
      <span className={`mt-[2px] shrink-0 ${toneText[tone]}`}><CalloutIcon tone={tone} /></span>
      <div className="min-w-0 flex-1">
        {value.title ? <div className={`font-semibold ${banner ? toneText[tone] : ''}`}>{value.title}</div> : null}
        <BlockMarkdown source={value.markdown} sessionId={sessionId} />
      </div>
    </div>
  );
}

function TableNode({ props, sessionId }: { props: unknown; sessionId?: string }) {
  const value = propsOf<{ columns: string[]; rows: Array<Array<string | number>> }>(blockProps.Table, props);
  if (!value || value.columns.length === 0) return null;
  const numeric = value.columns.map((_, index) => value.rows.length > 0 && value.rows.every((row) => typeof row[index] === 'number'));
  const lines = [
    `| ${value.columns.map((column) => tableCell(column)).join(' | ')} |`,
    `| ${numeric.map((isNumeric) => (isNumeric ? '---:' : '---')).join(' | ')} |`,
    ...value.rows.map((row) => `| ${value.columns.map((_, index) => tableCell(row[index])).join(' | ')} |`),
  ];
  return <BlockMarkdown source={lines.join('\n')} sessionId={sessionId} />;
}

type StepStatus = 'done' | 'current' | 'todo' | 'blocked';
type StepItem = { title: string; markdown?: string; status?: StepStatus };

const STEP_MIN_WIDTH_REM = 7;

/** Une rangée d'étapes passe en colonne si elle ne tient pas dans la largeur. */
function useStepsFitRow(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    // Le premier rendu (SSR, test statique) garde la rangée ; le navigateur
    // ajuste dès que la largeur est connue.
    if (typeof ResizeObserver === 'undefined' || count === 0) return;
    const element = ref.current;
    if (!element) return;
    const view = element.ownerDocument.defaultView;
    if (!view) return;
    const check = () => {
      const rem = parseFloat(view.getComputedStyle(element.ownerDocument.documentElement).fontSize) || 16;
      setFits(element.clientWidth >= count * STEP_MIN_WIDTH_REM * rem);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count]);
  return [ref, fits] as const;
}

function StepMark({ status, index }: { status: StepStatus; index: number }) {
  const base = 'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold';
  if (status === 'done') {
    return (
      <span className={`${base} bg-green text-white`}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m5 12 4 4L19 6" />
        </svg>
      </span>
    );
  }
  if (status === 'blocked') return <span className={`${base} bg-danger text-white`}>!</span>;
  if (status === 'current') {
    return (
      <span className={`${base} bg-green ring-2 ring-green-soft`}>
        <span className="h-[6px] w-[6px] rounded-full bg-white" />
      </span>
    );
  }
  return <span className={`${base} border border-border text-muted`}>{index + 1}</span>;
}

const stepTitleTone: Record<StepStatus, string> = {
  done: '',
  current: 'text-green',
  blocked: 'text-danger',
  todo: 'text-muted',
};

const stepLine = (status: StepStatus) => (status === 'done' ? 'bg-green' : 'bg-border');

function StepText({ item, sessionId }: { item: StepItem; sessionId?: string }) {
  return (
    <>
      <div className={`text-[12.5px] font-medium ${stepTitleTone[item.status ?? 'todo']}`}>{item.title}</div>
      {item.markdown ? <div className="text-[11.5px] text-muted"><BlockMarkdown source={item.markdown} sessionId={sessionId} /></div> : null}
    </>
  );
}

function StepsRow({ items, sessionId }: { items: StepItem[]; sessionId?: string }) {
  return (
    <div className="grid" role="list" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item, index) => (
        <div key={index} className="flex min-w-0 flex-col gap-[6px]" role="listitem">
          <div className="flex items-center">
            <StepMark status={item.status ?? 'todo'} index={index} />
            {index < items.length - 1 ? <span className={`mx-[6px] h-[2px] flex-1 rounded-full ${stepLine(item.status ?? 'todo')}`} /> : null}
          </div>
          <div className="min-w-0 pe-[10px]"><StepText item={item} sessionId={sessionId} /></div>
        </div>
      ))}
    </div>
  );
}

function StepsColumn({ items, sessionId }: { items: StepItem[]; sessionId?: string }) {
  return (
    <div className="flex flex-col" role="list">
      {items.map((item, index) => (
        <div key={index} className="flex gap-[9px]" role="listitem">
          <div className="flex flex-col items-center pt-[2px]">
            <StepMark status={item.status ?? 'todo'} index={index} />
            {index < items.length - 1 ? <span className={`my-[4px] min-h-[12px] w-[2px] flex-1 rounded-full ${stepLine(item.status ?? 'todo')}`} /> : null}
          </div>
          <div className={index < items.length - 1 ? 'min-w-0 flex-1 pb-[10px]' : 'min-w-0 flex-1'}>
            <StepText item={item} sessionId={sessionId} />
          </div>
        </div>
      ))}
    </div>
  );
}

function StepsNode({ props, sessionId }: { props: unknown; sessionId?: string }) {
  const value = propsOf<{ items: StepItem[]; direction?: 'column' | 'row' }>(blockProps.Steps, props);
  const [ref, fits] = useStepsFitRow(value?.direction === 'row' ? value.items.length : 0);
  if (!value) return null;
  return (
    <div ref={ref} className="ps-[2px] pt-[2px]">
      {value.direction === 'row' && fits
        ? <StepsRow items={value.items} sessionId={sessionId} />
        : <StepsColumn items={value.items} sessionId={sessionId} />}
    </div>
  );
}

function StatNode({ props }: { props: unknown }) {
  const value = propsOf<{ label: string; value: string | number; delta?: string; tone?: Tone }>(blockProps.Stat, props);
  if (!value) return null;
  const tone = value.tone ?? 'neutral';
  return (
    <div className="flex w-fit min-w-[10rem] flex-col gap-[3px] rounded-[8px] border border-border bg-render px-[10px] py-[8px]">
      <span className="text-[10.5px] text-muted">{value.label}</span>
      <span className="text-[22px] font-semibold leading-[1.15] tabular-nums">{display(value.value)}</span>
      {value.delta ? <span className={`w-fit rounded-full border px-[6px] py-[1px] text-[10.5px] tabular-nums ${toneBadge[tone]}`}>{value.delta}</span> : null}
    </div>
  );
}

function ProgressNode({ props }: { props: unknown }) {
  const value = propsOf<{ label: string; value: number; max?: number }>(blockProps.Progress, props);
  if (!value) return null;
  const max = value.max ?? 100;
  const share = Math.max(0, Math.min(1, value.value / max));
  const done = share >= 1;
  const percent = done ? 100 : Math.max(0, Math.min(99, Math.floor((value.value * 100) / max)));
  return (
    <div className="flex flex-col gap-[5px]">
      <div className="flex items-baseline justify-between gap-[10px]">
        <span className="min-w-0 truncate text-[12px]">{value.label}</span>
        <span className={`shrink-0 text-[11.5px] font-semibold tabular-nums ${done ? 'text-green' : 'text-muted'}`}>{percent}%</span>
      </div>
      <div
        className="h-[7px] overflow-hidden rounded-full bg-track"
        role="progressbar"
        aria-valuenow={value.value}
        aria-valuemax={max}
        aria-label={value.label}
      >
        <div className={`h-full rounded-full ${done ? 'bg-green' : 'bg-orange'}`} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

function KeyValueNode({ props }: { props: unknown }) {
  const value = propsOf<{ items: Array<{ label: string; value: string | number }> }>(blockProps.KeyValue, props);
  if (!value) return null;
  return (
    <dl className="m-0 grid max-w-lg grid-cols-[fit-content(55%)_minmax(0,1fr)] gap-y-[2px]">
      {value.items.map((item, index) => (
        <div key={index} className="contents">
          <dt className="flex min-w-0 items-baseline gap-[8px] text-muted">
            <span className="min-w-0 [overflow-wrap:anywhere]">{item.label}</span>
            <span aria-hidden className="min-w-[12px] flex-1 border-b border-dotted border-border" />
          </dt>
          <dd className="m-0 flex min-w-0 items-baseline">
            <span aria-hidden className="min-w-0 flex-1 border-b border-dotted border-border" />
            <span className="ps-[8px] text-end tabular-nums [overflow-wrap:anywhere]">{display(item.value)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CardNode({ props, sessionId, children }: { props: unknown; sessionId?: string; children: ReactNode }) {
  const value = propsOf<{ title: string }>(blockProps.Card, props);
  if (!value) return null;
  return (
    <div className="flex flex-col gap-[6px] rounded-[8px] border border-border bg-white px-[10px] py-[8px]">
      {value.title ? <div className="text-[12.5px] font-semibold"><BlockMarkdown source={value.title} sessionId={sessionId} /></div> : null}
      {children}
    </div>
  );
}

function Node({ value, sessionId }: { value: BlockValue; sessionId?: string }) {
  const node = blockNode.safeParse(value);
  if (!node.success) return null;
  const { typeName, props } = node.data;
  const rawChildren = props.children;
  const children = Array.isArray(rawChildren) ? rawChildren : [];
  const stack = <>{children.map((child, index) => <Node key={index} value={child} sessionId={sessionId} />)}</>;

  switch (typeName) {
    case 'Stack':
      return <div className="flex flex-col gap-[10px]">{stack}</div>;
    case 'Row':
      return <div className="flex flex-wrap items-stretch gap-[10px]">{stack}</div>;
    case 'Card':
      return <CardNode props={props} sessionId={sessionId}>{stack}</CardNode>;
    case 'Text':
      return <TextNode props={props} sessionId={sessionId} />;
    case 'Badge':
      return <BadgeNode props={props} />;
    case 'Callout':
      return <CalloutNode props={props} sessionId={sessionId} />;
    case 'Table':
      return <TableNode props={props} sessionId={sessionId} />;
    case 'Steps':
      return <StepsNode props={props} sessionId={sessionId} />;
    case 'Stat':
      return <StatNode props={props} />;
    case 'Progress':
      return <ProgressNode props={props} />;
    case 'KeyValue':
      return <KeyValueNode props={props} />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Garde-fous et point d'entrée                                        */
/* ------------------------------------------------------------------ */

function supported(value: BlockValue): boolean {
  const node = blockNode.safeParse(value);
  if (!node.success || !SUPPORTED.has(node.data.typeName)) return false;
  const children = node.data.props.children;
  return !Array.isArray(children) || children.every(supported);
}

class UiBlockBoundary extends Component<
  { source: string; fallback: ReactNode; children: ReactNode },
  { failed: boolean; source: string }
> {
  state = { failed: false, source: this.props.source };

  static getDerivedStateFromProps(props: { source: string }, state: { source: string }) {
    return props.source !== state.source ? { failed: false, source: props.source } : null;
  }

  componentDidCatch() {
    this.setState({ failed: true });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function RawBlock({ source }: { source: string }) {
  return (
    <pre dir="ltr" data-testid="ui-block-raw" className="ui-block-raw">
      <code>{source}</code>
    </pre>
  );
}

export const UiBlock = memo(function UiBlock({
  source,
  sessionId,
}: {
  source: string;
  sessionId?: string;
}) {
  const parsed = useMemo(() => parseUiBlock(source, true, false), [source]);
  if (parsed.kind !== 'ready' || !supported(parsed.root)) return <RawBlock source={source} />;
  return (
    <div className="ui-block" data-testid="ui-block">
      <UiBlockBoundary source={source} fallback={<RawBlock source={source} />}>
        <Node value={parsed.root} sessionId={sessionId} />
      </UiBlockBoundary>
    </div>
  );
});

/**
 * Composants `pre`/`code` à passer à react-markdown : un fence
 * ```openui-lang devient un `UiBlock`, le reste garde le rendu code normal.
 */
export function uiBlockComponents(sessionId?: string): Components {
  return {
    pre: ({ children }) => {
      const child = Array.isArray(children) ? children[0] : children;
      if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
        const language = /(?:^|\s)language-([\w-]+)/.exec(child.props.className ?? '')?.[1];
        if (language === 'openui-lang') {
          return <UiBlock source={String(child.props.children ?? '').replace(/\n$/, '')} sessionId={sessionId} />;
        }
      }
      return <pre>{children}</pre>;
    },
  };
}
