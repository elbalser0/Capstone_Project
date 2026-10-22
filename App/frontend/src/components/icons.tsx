// Icons exported from the Figma file as SVG, with the stroke switched to currentColor.

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = (width: number, height: number, props: IconProps) => ({
  width,
  height,
  viewBox: `0 0 ${width} ${height}`,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
});

export const ClipboardIcon = (p: IconProps) => (
  <svg {...base(13, 15, p)}>
    <path d="M2.25 2.25H10.25C11.0784 2.25 11.75 2.92157 11.75 3.75V12.75C11.75 13.5784 11.0784 14.25 10.25 14.25H2.25C1.42157 14.25 0.75 13.5784 0.75 12.75V3.75C0.75 2.92157 1.42157 2.25 2.25 2.25Z" />
    <path d="M7.75 0.75H4.75C4.19772 0.75 3.75 1.19772 3.75 1.75V2.75C3.75 3.30228 4.19772 3.75 4.75 3.75H7.75C8.30228 3.75 8.75 3.30228 8.75 2.75V1.75C8.75 1.19772 8.30228 0.75 7.75 0.75Z" fill="white" />
    <path d="M3.25 8.75L5.25 10.75L9.25 6.75" />
  </svg>
);

export const SendIcon = (p: IconProps) => (
  <svg {...base(15, 15, p)}>
    <path d="M0.75 6.25L13.75 0.75L8.25 13.75L6.75 7.75L0.75 6.25Z" />
  </svg>
);

export const EyeIcon = (p: IconProps) => (
  <svg {...base(16, 9, p)}>
    <path d="M0.75 4.5C5.41667 -0.5 10.0833 -0.5 14.75 4.5C10.0833 9.5 5.41667 9.5 0.75 4.5Z" />
    <path d="M9.95005 4.50005C9.95005 5.71507 8.96508 6.70004 7.75005 6.70004C6.53502 6.70004 5.55005 5.71507 5.55005 4.50005C5.55005 3.28502 6.53502 2.30005 7.75005 2.30005C8.96508 2.30005 9.95005 3.28502 9.95005 4.50005Z" />
  </svg>
);

export const ChatIcon = (p: IconProps) => (
  <svg {...base(15, 14, p)}>
    <path d="M0.75 0.75H13.75V9.75H6.25L3.25 12.75V9.75H0.75V0.75Z" />
  </svg>
);

export const HelpIcon = (p: IconProps) => (
  <svg {...base(16, 16, p)}>
    <path d="M14.75 7.75C14.75 11.616 11.616 14.75 7.75 14.75C3.88401 14.75 0.75 11.616 0.75 7.75C0.75 3.88401 3.88401 0.75 7.75 0.75C11.616 0.75 14.75 3.88401 14.75 7.75Z" />
    <path d="M5.65002 5.95004C5.65266 5.54583 5.76661 5.15018 5.97936 4.80649C6.19211 4.46279 6.49544 4.18429 6.85605 4.00168C7.21666 3.81906 7.62062 3.73937 8.02357 3.77127C8.42653 3.80316 8.81291 3.94545 9.1403 4.18252C9.46769 4.4196 9.72344 4.74225 9.87947 5.11514C10.0355 5.48803 10.0858 5.8967 10.0248 6.29629C9.96381 6.69588 9.79391 7.07097 9.53375 7.38034C9.27359 7.68971 8.93323 7.92139 8.55002 8.05002V9.35" />
    <path d="M7.74998 12.6501C8.24703 12.6501 8.64998 12.2472 8.64998 11.7501C8.64998 11.2531 8.24703 10.8501 7.74998 10.8501C7.25292 10.8501 6.84998 11.2531 6.84998 11.7501C6.84998 12.2472 7.25292 12.6501 7.74998 12.6501Z" fill="currentColor" stroke="none" />
  </svg>
);

export const LogoutIcon = (p: IconProps) => (
  <svg {...base(14, 14, p)}>
    <path d="M5.25 0.75H0.75V12.75H5.25M4.25 6.75H12.75M9.75 9.75L12.75 6.75L9.75 3.75" />
  </svg>
);

export const CalendarIcon = (p: IconProps) => (
  <svg {...base(14, 14, p)}>
    <path d="M2.75 2.25H10.75C11.8546 2.25 12.75 3.14543 12.75 4.25V11.25C12.75 12.3546 11.8546 13.25 10.75 13.25H2.75C1.64543 13.25 0.75 12.3546 0.75 11.25V4.25C0.75 3.14543 1.64543 2.25 2.75 2.25Z" />
    <path d="M0.75 6.25H12.75" />
    <path d="M4.25 0.75V3.75M9.25 0.75V3.75" />
  </svg>
);

export const InfoIcon = (p: IconProps) => (
  <svg {...base(16, 16, p)}>
    <path d="M14.75 7.75C14.75 11.616 11.616 14.75 7.75 14.75C3.88401 14.75 0.75 11.616 0.75 7.75C0.75 3.88401 3.88401 0.75 7.75 0.75C11.616 0.75 14.75 3.88401 14.75 7.75Z" />
    <path d="M7.75 7.25V11.25" />
    <path d="M7.74997 5.45001C8.24703 5.45001 8.64996 5.04704 8.64996 4.54999C8.64996 4.05293 8.24703 3.65002 7.74997 3.65002C7.25291 3.65002 6.84998 4.05293 6.84998 4.54999C6.84998 5.04704 7.25291 5.45001 7.74997 5.45001Z" fill="currentColor" stroke="none" />
  </svg>
);

export const DownloadIcon = (p: IconProps) => (
  <svg {...base(13, 14, p)}>
    <path d="M6.25 0.75V9.25M9.75 5.75L6.25 9.25L2.75 5.75M0.75 9.75V12.75H11.75" />
  </svg>
);

export const GridIcon = (p: IconProps) => (
  <svg {...base(14, 14, p)}>
    <path d="M1.75 0.75H5.25C5.80228 0.75 6.25 1.19772 6.25 1.75V5.25C6.25 5.80228 5.80228 6.25 5.25 6.25H1.75C1.19772 6.25 0.75 5.80228 0.75 5.25V1.75C0.75 1.19772 1.19772 0.75 1.75 0.75Z" />
    <path d="M1.75 7.25H5.25C5.80228 7.25 6.25 7.69772 6.25 8.25V11.75C6.25 12.3023 5.80228 12.75 5.25 12.75H1.75C1.19772 12.75 0.75 12.3023 0.75 11.75V8.25C0.75 7.69772 1.19772 7.25 1.75 7.25Z" />
    <path d="M8.25 0.75H11.75C12.3023 0.75 12.75 1.19772 12.75 1.75V5.25C12.75 5.80228 12.3023 6.25 11.75 6.25H8.25C7.69772 6.25 7.25 5.80228 7.25 5.25V1.75C7.25 1.19772 7.69772 0.75 8.25 0.75Z" />
    <path d="M8.25 7.25H11.75C12.3023 7.25 12.75 7.69772 12.75 8.25V11.75C12.75 12.3023 12.3023 12.75 11.75 12.75H8.25C7.69772 12.75 7.25 12.3023 7.25 11.75V8.25C7.25 7.69772 7.69772 7.25 8.25 7.25Z" />
  </svg>
);

export const UsersIcon = (p: IconProps) => (
  <svg {...base(15, 13, p)}>
    <path d="M8.05019 3.55C8.05019 5.0964 6.79659 6.35001 5.25019 6.35001C3.7038 6.35001 2.4502 5.0964 2.4502 3.55C2.4502 2.00361 3.7038 0.75 5.25019 0.75C6.79659 0.75 8.05019 2.00361 8.05019 3.55Z" />
    <path d="M0.75 12.0498C0.75 10.8563 1.22411 9.71174 2.06802 8.86783C2.91193 8.02391 4.05653 7.5498 5.25 7.5498C6.44347 7.5498 7.58807 8.02391 8.43198 8.86783C9.27589 9.71174 9.75 10.8563 9.75 12.0498" />
    <path d="M9.75 1.5498C10.1999 1.70263 10.5969 1.98049 10.8945 2.35083C11.1921 2.72117 11.3781 3.16864 11.4305 3.64085C11.483 4.11306 11.3998 4.59045 11.1907 5.01709C10.9817 5.44373 10.6553 5.80195 10.25 6.0498M11.75 8.2498C12.466 8.58502 13.0666 9.12488 13.4759 9.80121C13.8853 10.4775 14.0851 11.26 14.05 12.0498" />
  </svg>
);

export const ListIcon = (p: IconProps) => (
  <svg {...base(13, 10, p)}>
    <path d="M4.2002 1H12.2002M4.2002 5H12.2002M4.2002 9H12.2002" />
    <circle cx="1" cy="1" r="1" fill="currentColor" stroke="none" />
    <circle cx="1" cy="5" r="1" fill="currentColor" stroke="none" />
    <circle cx="1" cy="9" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const DocIcon = (p: IconProps) => (
  <svg {...base(12, 15, p)}>
    <path d="M0.75 0.75H7.25L10.75 4.25V13.75H0.75V0.75Z" />
    <path d="M3.25 7.75H8.25M3.25 10.75H8.25" />
  </svg>
);

export const FolderIcon = (p: IconProps) => (
  <svg {...base(15, 12, p)}>
    <path d="M0.75 0.75H5.25L6.75 2.75H13.75V11.25H0.75V0.75Z" />
  </svg>
);

// The icons below keep the Figma's own coordinates; the view box adds half the stroke on
// each side so nothing is clipped, and width/height props scale them.
const drawn = (w: number, h: number, stroke: number, p: IconProps) =>
  base(w + stroke, h + stroke, { viewBox: `${-stroke / 2} ${-stroke / 2} ${w + stroke} ${h + stroke}`, strokeWidth: stroke, ...p });

export const CheckIcon = (p: IconProps) => (
  <svg {...drawn(10, 7.5, 2, p)}>
    <path d="M0 4L3.5 7.5L10 0" />
  </svg>
);

export const ClockIcon = (p: IconProps) => (
  <svg {...drawn(14, 14, 1.5, p)}>
    <circle cx="7" cy="7" r="7" />
    <path d="M7 3.5V7L9.5 8.5" />
  </svg>
);

export const PenIcon = (p: IconProps) => (
  <svg {...drawn(12, 12, 1.5, p)}>
    <path d="M0 12L0.5 8.5L9 0L12 3L3.5 11.5L0 12Z" />
  </svg>
);

export const LockIcon = (p: IconProps) => (
  <svg {...drawn(10, 13, 1.5, p)}>
    <rect x="0" y="5" width="10" height="8" rx="1.5" />
    <path d="M2 5V3C2 1.34 3.34 0 5 0C6.66 0 8 1.34 8 3V5" />
  </svg>
);

export const FlagIcon = (p: IconProps) => (
  <svg {...drawn(9.5, 13, 1.5, p)}>
    <path d="M0 13V0M0 0.5H9.5L7.5 3.5L9.5 6.5H0" />
  </svg>
);

export const UploadIcon = (p: IconProps) => (
  <svg {...drawn(11, 12, 1.5, p)}>
    <path d="M5.5 9V0M5.5 0L2 3.5M5.5 0L9 3.5M0 9V12H11" />
  </svg>
);

export const PlusIcon = (p: IconProps) => (
  <svg {...drawn(10, 10, 1.5, p)}>
    <path d="M5 0V10M0 5H10" />
  </svg>
);

export const XIcon = (p: IconProps) => (
  <svg {...drawn(6, 6, 1.5, p)}>
    <path d="M0 0L6 6M6 0L0 6" />
  </svg>
);

export const MailIcon = (p: IconProps) => (
  <svg {...drawn(13, 10, 1.5, p)}>
    <rect x="0" y="0" width="13" height="10" rx="1.5" />
    <path d="M0.5 1L6.5 6L12.5 1" />
  </svg>
);

export const AlertIcon = (p: IconProps) => (
  <svg {...drawn(14, 12.5, 1.5, p)}>
    <path d="M7 0L14 12.5H0L7 0Z" />
    <path d="M7 4.5V8" />
    <circle cx="7" cy="10.3" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

export const LinkIcon = (p: IconProps) => (
  <svg {...drawn(9, 9, 1.5, p)}>
    <path d="M2.5 6.5L6.5 2.5M3.5 1C4.1 0.36 4.9 0 5.77 0C6.63 0 7.43 0.36 8 1C8.65 1.57 9.03 2.39 9.03 3.27C9.03 4.14 8.65 4.96 8 5.52M5.52 8C4.96 8.65 4.14 9.03 3.27 9.03C2.39 9.03 1.57 8.65 1 8C0.36 7.43 0 6.63 0 5.77C0 4.9 0.36 4.1 1 3.52" />
  </svg>
);

export const SearchIcon = (p: IconProps) => (
  <svg {...drawn(12.5, 12.5, 1.5, p)}>
    <circle cx="5" cy="5" r="5" />
    <path d="M9 9L12.5 12.5" />
  </svg>
);

export const ChevronIcon = (p: IconProps) => (
  <svg {...drawn(8, 4, 1.5, p)}>
    <path d="M0 0L4 4L8 0" />
  </svg>
);
