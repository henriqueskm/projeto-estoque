import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const commonProps: IconProps = {
  "aria-hidden": true,
  fill: "none",
  viewBox: "0 0 24 24",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function HomeIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10M9 20v-6h6v6" />
    </svg>
  );
}

export function InboundIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="M12 3v10m0 0 4-4m-4 4L8 9" />
      <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

export function OutboundIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="M12 21V11m0 0 4 4m-4-4-4 4" />
      <path d="M5 10V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" />
    </svg>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="M4 7h3l1.4-2h7.2L17 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

export function AssistantIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="M7 18.5 3.5 21l.8-4.2A8 8 0 1 1 7 18.5Z" />
      <path d="m12 7 .5 1.5L14 9l-1.5.5L12 11l-.5-1.5L10 9l1.5-.5L12 7Z" />
      <path d="m16.5 11 .3.9.9.3-.9.3-.3.9-.3-.9-.9-.3.9-.3.3-.9Z" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

export function StockIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="m4 7 8-4 8 4-8 4-8-4Z" />
      <path d="m4 7v10l8 4 8-4V7M12 11v10" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
      <path d="M14 8l4 4-4 4m4-4H9" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="m15 18-6-6 6-6M9 12h11" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13" />
      <path d="M10 11v5m4-5v5" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}
