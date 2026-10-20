import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import type { DueStatus } from '../api/types';
import { AlertIcon, CheckIcon, InfoIcon, LockIcon, XIcon } from './icons';

export function Logo() {
  return (
    <span className="flex items-center gap-2 text-[15px] font-bold text-gray-900">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M16 0H4C1.79086 0 0 1.79086 0 4V16C0 18.2091 1.79086 20 4 20H16C18.2091 20 20 18.2091 20 16V4C20 1.79086 18.2091 0 16 0Z" fill="#B4520F" />
        <path d="M4.5 15L10 5L15.5 15M6.8 11H13.2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" stroke="white" />
      </svg>
      Assessment Helper
    </span>
  );
}

/** primary: brand fill; secondary: white outline; danger: outline with red text; done: a step already taken (A4). */
type Variant = 'primary' | 'secondary' | 'danger' | 'done';
/** md is the 40px Figma button; compact (36px) sits beside page headings; sm (32px) in table rows; xs (28px) in the template list. */
type Size = 'md' | 'compact' | 'sm' | 'xs';
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

const SIZES: Record<Size, string> = { md: 'h-10 px-4 text-sm', compact: 'h-9 px-4 text-sm', sm: 'h-8 px-4 text-sm', xs: 'h-7 px-3 text-[13px]' };

/** Button look, also used on links that act as buttons. */
export function buttonClass(variant: Variant = 'primary', extra = '', size: Size = 'md') {
  const look = {
    primary: 'bg-brand text-white hover:bg-brand-hover disabled:opacity-60',
    secondary: 'border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-50',
    danger: 'border border-gray-300 bg-white text-red-800 hover:bg-gray-50 disabled:opacity-50',
    done: 'border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 disabled:opacity-50',
  }[variant];
  return `inline-flex items-center justify-center gap-2 rounded-md font-bold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${SIZES[size]} ${look} ${extra}`;
}

export function Button({ variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  return <button className={buttonClass(variant, className, size)} {...props} />;
}

const TAG_LOOK = {
  due: 'bg-amber-100 text-amber-800',
  overdue: 'bg-red-100 text-red-800',
  signed: 'bg-green-100 text-green-800',
  neutral: 'bg-gray-200 text-gray-700',
};
export type TagTone = keyof typeof TAG_LOOK;

/** Status label. Never clickable, so it stays a flat label rather than a button shape. */
export function Tag({ tone, icon, children }: { tone: TagTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`inline-flex h-[22px] shrink-0 items-center gap-[7px] rounded px-2.5 text-xs font-bold whitespace-nowrap ${TAG_LOOK[tone]}`}>
      {icon}
      {children}
    </span>
  );
}

/** Tone and label for a DUE / OVERDUE / NOT DUE status. */
export const DUE_TAG: Record<DueStatus, [TagTone, string]> = { DUE: ['due', 'DUE'], OVERDUE: ['overdue', 'OVERDUE'], NOT_DUE: ['neutral', 'NOT DUE'] };

export const DueTag = ({ status }: { status: DueStatus }) => <Tag tone={DUE_TAG[status][0]}>{DUE_TAG[status][1]}</Tag>;

export const LockedTag = () => <Tag tone="signed" icon={<LockIcon width={8} height={10} />}>Signed and locked</Tag>;

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`rounded-lg border border-gray-200 bg-white ${className}`}>{children}</section>;
}

/** Renders nothing until there is an error. */
export function ErrorNote({ error, className = '' }: { error: unknown; className?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className={`rounded-md border border-red-100 bg-red-100/50 px-4 py-3 text-sm text-red-800 ${className}`}>
      {error instanceof Error ? error.message : 'Something went wrong.'}
    </p>
  );
}

/** A page that could not load: the error where the content would start. */
export const PageError = ({ error }: { error: unknown }) => <div className="pt-8"><ErrorNote error={error} /></div>;

/** Underlined text link look (Figma "Link / ..."), for <Link> and <button>. */
export const linkClass = 'inline-flex items-center gap-2 text-sm text-gray-900 underline underline-offset-[3px] hover:text-brand focus-visible:outline-2 focus-visible:outline-brand';

const FIELD =
  'rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-500 focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-brand/30 disabled:bg-gray-50';

/** Single-line input look; add the width (w-full, w-14, ...) where it is used. */
export const inputClass = `${FIELD} h-10`;

/** Bold label above a field. */
export const labelClass = 'mb-[7px] block text-sm font-bold text-gray-900';

export function TextArea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${FIELD} w-full resize-y py-2.5 leading-5 ${className}`} {...props} />;
}

// ---------- Choice controls (native inputs with the Figma look) ----------

export function Radio(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'>) {
  return (
    <span className="relative inline-flex size-[15px] shrink-0">
      <input
        type="radio"
        className="peer size-full cursor-pointer appearance-none rounded-full border-[1.5px] border-gray-500 bg-white checked:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default"
        {...props}
      />
      <span className="pointer-events-none absolute inset-[3.5px] rounded-full bg-brand opacity-0 peer-checked:opacity-100" />
    </span>
  );
}

export function Checkbox({ indeterminate = false, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & { indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const on = props.checked || indeterminate;
  return (
    <span className="relative inline-flex size-4 shrink-0">
      <input
        ref={ref}
        type="checkbox"
        className="peer size-full cursor-pointer appearance-none rounded-[3px] border-[1.5px] border-gray-500 bg-white checked:border-brand checked:bg-brand indeterminate:border-brand indeterminate:bg-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default disabled:opacity-50"
        {...props}
      />
      {on && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
          {indeterminate && !props.checked ? <span className="h-[2px] w-2 rounded bg-white" /> : <CheckIcon width={10} height={8} />}
        </span>
      )}
    </span>
  );
}

/** 1 to 5 rating boxes. Read-only without onChange; a radio group with it. */
export function RatingScale({
  value,
  onChange,
  min = 1,
  max = 5,
  size = 28,
  round = false,
  label,
}: {
  value: number | null;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  size?: 28 | 36;
  round?: boolean;
  label: string;
}) {
  const name = useId();
  const options = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const box = `flex items-center justify-center text-sm ${size === 36 ? 'size-9' : 'size-7'} ${round ? 'rounded-full text-[13px]' : 'rounded-md'}`;
  const look = (on: boolean) => (on ? 'border-2 border-brand bg-brand-50 font-bold text-gray-900' : 'border border-gray-300 bg-white text-gray-700');
  const gap = size === 36 ? 'gap-2' : round ? 'gap-2.5' : 'gap-1.5';
  if (!onChange) {
    return (
      <div className={`flex ${gap}`} role="img" aria-label={value === null ? `${label}: not rated` : `${label}: ${value} of ${max}`}>
        {options.map((n) => <span key={n} className={`${box} ${look(n === value)}`}>{n}</span>)}
      </div>
    );
  }
  return (
    <div role="radiogroup" aria-label={label} className={`flex ${gap}`}>
      {options.map((n) => (
        <label key={n} className={`${box} ${look(n === value)} cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand`}>
          <input type="radio" name={name} value={n} checked={n === value} onChange={() => onChange(n)} className="sr-only" />
          {n}
        </label>
      ))}
    </div>
  );
}

// ---------- Banners and notes ----------

const BANNER_LOOK = {
  info: { box: 'bg-blue-100 text-blue-900', icon: <InfoIcon width={14} height={14} /> },
  danger: { box: 'bg-red-100 text-red-800', icon: <AlertIcon width={14} height={13} /> },
};

/** One-line banner across the content (info blue or attention red), optional action on the right. */
export function Banner({ tone, children, action }: { tone: keyof typeof BANNER_LOOK; children: ReactNode; action?: ReactNode }) {
  const look = BANNER_LOOK[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex min-h-12 items-center gap-3 rounded-lg px-4 py-3 text-sm font-bold ${look.box}`}>
      <span className="shrink-0">{look.icon}</span>
      <span className="flex-1">{children}</span>
      {action && <span className="shrink-0 pr-2.5 font-normal text-gray-900">{action}</span>}
    </div>
  );
}

const CALLOUT_LOOK = {
  warning: 'bg-amber-100 text-amber-800',
  success: 'bg-green-100 text-green-800',
};

/** Two-line status banner: 16px title over a 14px line. */
export function Callout({ tone, title, children }: { tone: keyof typeof CALLOUT_LOOK; title: ReactNode; children?: ReactNode }) {
  return (
    <div role="status" className={`rounded-lg px-6 pt-4 pb-[17px] ${CALLOUT_LOOK[tone]}`}>
      <p className="text-base leading-[19px] font-bold">{title}</p>
      {children && <p className="mt-[7px] text-sm">{children}</p>}
    </div>
  );
}

/** Light blue note: bold first line, regular second line. */
export function Note({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg bg-blue-50 px-5 py-2.5 text-sm text-blue-800 ${className}`}>
      {title && <p className="leading-[17px] font-bold">{title}</p>}
      <p className={`leading-[17px] ${title ? 'mt-[5px]' : ''}`}>{children}</p>
    </div>
  );
}

/** Gray icon + text line (Figma "Note / ..." and "Info line"). */
export function InfoLine({ icon, children, className = '' }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <p className={`flex items-center gap-[9px] text-sm text-gray-500 ${className}`}>
      <span className="flex w-[15px] shrink-0 justify-center">{icon ?? <InfoIcon width={14} height={14} />}</span>
      {children}
    </p>
  );
}

/** Gray box with a lock icon (record-locking notes). */
export function LockNote({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-[18px] py-[15px] text-sm text-gray-700 ${className}`}>
      <span className="shrink-0 text-gray-700"><LockIcon /></span>
      <p>{children}</p>
    </div>
  );
}

/** Numbered "What happens next" steps. */
export function Steps({ items, tone = 'gray' }: { items: ReactNode[]; tone?: 'gray' | 'brand' }) {
  const dot = tone === 'brand' ? 'size-[22px] bg-orange-50 text-brand' : 'size-5 bg-gray-100 text-gray-700';
  const text = tone === 'brand' ? 'text-[13px] text-gray-700' : 'text-sm text-gray-500';
  return (
    <ol className={`flex flex-col ${tone === 'brand' ? 'gap-3.5' : 'gap-[15px]'}`}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className={`flex shrink-0 items-center justify-center rounded-full text-xs font-bold ${dot}`}>{i + 1}</span>
          <span className={`pt-px ${text}`}>{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function StatCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card className="px-5 pt-[17px] pb-[15px]">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-[7px] text-2xl leading-[29px] font-bold text-gray-900">{value}</p>
    </Card>
  );
}

/** Label over value, as in the summary and detail cards. */
export function Detail({ label, children, large = false }: { label: string; children: ReactNode; large?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`mt-[3px] text-gray-900 ${large ? 'text-base font-bold' : 'text-sm'}`}>{children}</dd>
    </div>
  );
}

// ---------- Tables and pagination ----------

/**
 * Bordered table with the gray header row. `columns` is a CSS grid template so header
 * and rows line up the way the Figma columns do.
 */
export function Table({ columns, head, label, children }: { columns: string; head: ReactNode[]; label: string; children: ReactNode }) {
  const style = { gridTemplateColumns: columns } as CSSProperties;
  return (
    <div role="table" aria-label={label} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div role="row" style={style} className="grid h-10 items-center gap-x-0 bg-gray-50 px-4 text-xs font-bold text-gray-500">
        {head.map((h, i) => <span key={i} role="columnheader">{h}</span>)}
      </div>
      <div role="rowgroup" className="divide-y divide-gray-200 border-t border-gray-200">
        <TableColumns.Provider value={style}>{children}</TableColumns.Provider>
      </div>
    </div>
  );
}

const TableColumns = createContext<CSSProperties>({});

export function Row({ children }: { children: ReactNode }) {
  const style = useContext(TableColumns);
  return <div role="row" style={style} className="grid min-h-12 items-center px-4 py-2 text-sm text-gray-900">{children}</div>;
}

export function Cell({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <span role="cell" className={`min-w-0 pr-3 ${className}`}>{children}</span>;
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="px-4 py-4 text-sm text-gray-500">{children}</p>;
}

export function usePages<T>(items: T[], size: number) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pages);
  const start = (current - 1) * size;
  return {
    page: current,
    pages,
    setPage,
    rows: items.slice(start, start + size),
    from: items.length ? start + 1 : 0,
    to: Math.min(start + size, items.length),
    total: items.length,
  };
}

export function Pagination({ pager }: { pager: ReturnType<typeof usePages<unknown>> }) {
  const { page, pages, setPage, from, to, total } = pager;
  if (total === 0) return null;
  const btn = 'flex size-8 items-center justify-center rounded-md text-sm focus-visible:outline-2 focus-visible:outline-brand';
  const plain = `${btn} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:text-gray-400 disabled:hover:bg-white`;
  return (
    <nav aria-label="Pages" className="flex items-center gap-5">
      <span className="text-sm text-gray-500">{`${from} to ${to} of ${total}`}</span>
      <span className="flex gap-1.5">
        <button type="button" className={plain} disabled={page === 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
        {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            aria-current={n === page ? 'page' : undefined}
            className={n === page ? `${btn} bg-brand font-bold text-white` : plain}
            onClick={() => setPage(n)}
          >
            {n}
          </button>
        ))}
        <button type="button" className={plain} disabled={page === pages} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
      </span>
    </nav>
  );
}

// ---------- Chips and tabs ----------

/** Toggle chip used for filters (A3) and picked times (E2a). */
export function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-2.5 rounded-md px-3.5 text-sm text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        selected ? 'border-[1.5px] border-brand bg-brand-50 font-bold' : 'border border-gray-300 bg-white hover:bg-gray-50'
      }`}
    >
      {selected && <CheckIcon width={10} height={8} className="text-brand" />}
      {children}
    </button>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-[27px] border-b border-gray-200">
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`relative h-[31px] text-sm focus-visible:outline-2 focus-visible:outline-brand ${on ? 'font-bold text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
          >
            {t.label}
            {on && <span className="absolute inset-x-0 -bottom-px h-[3px] bg-brand" />}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Modal ----------

export function Modal({ title, subtitle, onClose, width = 480, children, footer, closeButton = false }: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  width?: number;
  children: ReactNode;
  footer: ReactNode;
  /** The X in the corner (A6b). */
  closeButton?: boolean;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    (box.current?.querySelector<HTMLElement>('input:not(.sr-only), textarea, select') ?? box.current?.querySelector<HTMLElement>('button'))?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gray-900/32 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ width }} className="max-w-full rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg leading-[22px] font-bold text-gray-900">{title}</h2>
          {closeButton && (
            <button type="button" aria-label="Close" onClick={onClose} className="-mt-0.5 -mr-1.5 flex size-7 items-center justify-center rounded text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-brand">
              <XIcon width={10} height={10} strokeWidth={2} />
            </button>
          )}
        </div>
        {subtitle && <div className="mt-1.5 text-[13px] text-gray-500">{subtitle}</div>}
        <div className="mt-5">{children}</div>
        <div className="mt-6 flex items-center justify-end gap-3">{footer}</div>
      </div>
    </div>
  );
}
