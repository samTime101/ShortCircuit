import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function CircuitMark({ size = 28, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="currentColor" opacity="0.1" />
      <path
        d="M7 10h5.5l4 6H26M7 22h5.5l4-6"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="26" cy="16" r="2.4" fill="currentColor" />
    </svg>
  );
}

export const Play = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4.5 19 12 7 19.5Z" fill="currentColor" stroke="none" />
  </Icon>
);
export const Grid = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Icon>
);
export const Book = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5Z" />
    <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5Z" />
  </Icon>
);
export const Sliders = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Icon>
);
export const Download = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" />
  </Icon>
);
export const Copy = (p: IconProps) => (
  <Icon {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
  </Icon>
);
export const Check = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4 12.5 5 5L20 6.5" />
  </Icon>
);
export const X = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);
export const ChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const ChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);
export const AlertTriangle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.3 4.3 2.8 17.2A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.8L13.7 4.3a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 16.5h.01" />
  </Icon>
);
export const Info = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5h.01" />
  </Icon>
);
export const CircleCheck = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 2.7 2.7L16.5 9" />
  </Icon>
);
export const CircleX = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 8.5 7 7m0-7-7 7" />
  </Icon>
);
export const Layers = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
  </Icon>
);
export const Table = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M9 9v11M15 9v11" />
  </Icon>
);
export const Flask = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 3h6M10 3v5L4.8 17.5A2 2 0 0 0 6.5 20h11a2 2 0 0 0 1.7-2.5L14 8V3" />
    <path d="M7.5 14h9" />
  </Icon>
);
export const Braces = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2M16 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2" />
  </Icon>
);
export const RotateCcw = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 4v6h6M4.6 16a8 8 0 1 0 .8-9.8L3 10" />
  </Icon>
);
export const Plus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const Minus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
);
export const Maximize = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
  </Icon>
);
export const FileCode = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
    <path d="M14 3v6h6M9.5 13l-2 2 2 2M14.5 13l2 2-2 2" />
  </Icon>
);
export const Zap = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 2 4.5 13H11l-1 9 8.5-11H12Z" />
  </Icon>
);
export const Clock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.2 2" />
  </Icon>
);
export const Cpu = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
  </Icon>
);
export const Binary = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M8 9v6M16 9v6M8 12h8" />
  </Icon>
);
export const Code = (p: IconProps) => (
  <Icon {...p}>
    <path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16" />
  </Icon>
);
export const ArrowUpRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Icon>
);
export const Eye = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
export const Sparkle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4-5.7-1.8L10.2 9Z" />
  </Icon>
);
