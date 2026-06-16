// Простые контурные иконки для навигации (без внешних зависимостей).

type IconProps = { className?: string };

const base = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconDashboard({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="3.5" width="7.5" height="9" rx="2" />
      <rect x="13" y="3.5" width="7.5" height="5.5" rx="2" />
      <rect x="13" y="11.5" width="7.5" height="9" rx="2" />
      <rect x="3.5" y="14.5" width="7.5" height="6" rx="2" />
    </svg>
  );
}

export function IconImport({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 15V4" />
      <path d="M7 8.5 12 3.5l5 5" />
      <path d="M4.5 14.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export function IconList({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 6.5h12" />
      <path d="M8 12h12" />
      <path d="M8 17.5h12" />
      <circle cx="3.5" cy="6.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="17.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSwap({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 8h13" />
      <path d="M14 4l3 4-3 4" />
      <path d="M20 16H7" />
      <path d="M10 12l-3 4 3 4" />
    </svg>
  );
}

export function IconSettings({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.4M12 18.1v2.4M5.4 6.6l1.7 1.7M16.9 15.7l1.7 1.7M3.5 12h2.4M18.1 12h2.4M5.4 17.4l1.7-1.7M16.9 8.3l1.7-1.7" />
    </svg>
  );
}

export function IconSun({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
    </svg>
  );
}

export function IconMoon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
    </svg>
  );
}

export function IconAuto({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="5" width="17" height="12" rx="2.2" />
      <path d="M3.5 17v1.5a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V17" />
    </svg>
  );
}

export function IconEye({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

export function IconDownload({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3.5v11" />
      <path d="M7.5 10 12 14.5 16.5 10" />
      <path d="M4.5 19.5h15" />
    </svg>
  );
}

export function IconUpload({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 14.5v-11" />
      <path d="M7.5 8 12 3.5 16.5 8" />
      <path d="M4.5 19.5h15" />
    </svg>
  );
}
