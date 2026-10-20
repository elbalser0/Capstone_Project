import type { KeyboardEvent } from 'react';

export type Mode = 'faculty' | 'committee';

const OPTIONS: { mode: Mode; label: string }[] = [
  { mode: 'faculty', label: 'Faculty' },
  { mode: 'committee', label: 'Committee' },
];

/** Faculty | Committee switch at the top of the sidebar, shown only to Assessment Committee members. */
export function RoleToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(mode === 'faculty' ? 'committee' : 'faculty');
    }
  };
  return (
    <div
      role="radiogroup"
      aria-label="Pages to show"
      onKeyDown={onKeyDown}
      className="grid h-[30px] w-[188px] grid-cols-2 rounded-lg border border-gray-300 bg-gray-200 p-[2px]"
    >
      {OPTIONS.map((o) => {
        const selected = o.mode === mode;
        return (
          <button
            key={o.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.mode)}
            className={`rounded-md text-xs focus-visible:outline-2 focus-visible:outline-brand ${
              selected ? 'border border-gray-300 bg-white font-bold text-gray-900' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
