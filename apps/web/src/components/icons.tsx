import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export function MicIcon(props: IconProps) {
  return <IconBase {...props}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" /></IconBase>;
}

export function PauseIcon(props: IconProps) {
  return <IconBase {...props}><path d="M8 5v14M16 5v14" /></IconBase>;
}

export function PlayIcon(props: IconProps) {
  return <IconBase {...props}><path d="m8 5 11 7-11 7V5Z" /></IconBase>;
}

export function StopIcon(props: IconProps) {
  return <IconBase {...props}><rect x="6" y="6" width="12" height="12" rx="1" /></IconBase>;
}

export function VolumeOffIcon(props: IconProps) {
  return <IconBase {...props}><path d="M11 6 6.5 9.5H3v5h3.5L11 18V6ZM16 10l5 5M21 10l-5 5" /></IconBase>;
}

export function PencilIcon(props: IconProps) {
  return <IconBase {...props}><path d="m4 20 4.6-1 10.7-10.7a2.2 2.2 0 0 0-3.1-3.1L5.5 15.9 4 20Z" /><path d="m14.7 6.7 3 3" /></IconBase>;
}

export function DownloadIcon(props: IconProps) {
  return <IconBase {...props}><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></IconBase>;
}

export function TrashIcon(props: IconProps) {
  return <IconBase {...props}><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></IconBase>;
}

export function ArrowIcon(props: IconProps) {
  return <IconBase {...props}><path d="M5 12h14M14 7l5 5-5 5" /></IconBase>;
}

export function CheckIcon(props: IconProps) {
  return <IconBase {...props}><path d="m5 12 4 4L19 6" /></IconBase>;
}

export function SparkIcon(props: IconProps) {
  return <IconBase {...props}><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3ZM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" /></IconBase>;
}

export function TreeIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="12" cy="5" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M12 7.5v4M6 15.5v-4h12v4" /></IconBase>;
}

export function StoryIcon(props: IconProps) {
  return <IconBase {...props}><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z" /><path d="M8 20a3 3 0 0 1 0-6h11M9 8h6" /></IconBase>;
}

export function CalendarIcon(props: IconProps) {
  return <IconBase {...props}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></IconBase>;
}

export function UsersIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.2" /><path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M14.5 14.5a4 4 0 0 1 6 3.5v2" /></IconBase>;
}

export function WifiIcon(props: IconProps) {
  return <IconBase {...props}><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01" /></IconBase>;
}

export function ShieldIcon(props: IconProps) {
  return <IconBase {...props}><path d="M12 3 4.5 6v5.5c0 4.8 3 8 7.5 9.5 4.5-1.5 7.5-4.7 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-5" /></IconBase>;
}

export function ChevronIcon(props: IconProps) {
  return <IconBase {...props}><path d="m8 10 4 4 4-4" /></IconBase>;
}

export function CloseIcon(props: IconProps) {
  return <IconBase {...props}><path d="m6 6 12 12M18 6 6 18" /></IconBase>;
}
