/**
 * Ícones do Atlas — SVG inline, traço de 1.8, herdando `currentColor`.
 *
 * Um conjunto próprio em vez de uma biblioteca: o app usa ~20 ícones, e
 * qualquer pacote de ícones traria centenas para o bundle. Todos seguem
 * a mesma grade 24×24 para alinharem entre si.
 */

interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

function base({ size = 20, className, strokeWidth = 1.8 }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };
}

export function IconHome(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
    </svg>
  );
}

export function IconDroplet(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 1 1-13 0C5.5 10 12 3 12 3Z" />
      <path d="M9.5 14.5a3 3 0 0 0 2 2.8" opacity="0.6" />
    </svg>
  );
}

export function IconDumbbell(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6.5 6.5v11M4 8.5v7M17.5 6.5v11M20 8.5v7M6.5 12h11" />
    </svg>
  );
}

export function IconTrendingUp(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  );
}

export function IconUser(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  );
}

export function IconList(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 6h12M9 12h12M9 18h12" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" strokeWidth="2.6" />
    </svg>
  );
}

export function IconPulse(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 12h4l3-8 6 16 3-8h4" />
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 4.5v15l12-7.5L7 4.5Z" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 12.5 9.5 18 20 6.5" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconTimer(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 13.5V9M9.5 2.5h5" />
    </svg>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14.5 5 8 12l6.5 7" />
    </svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.5 5 16 12l-6.5 7" />
    </svg>
  );
}

export function IconFlame(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 21c3.9 0 6.5-2.6 6.5-6.2 0-3-2-5.2-3.6-7.3-.4 1.4-1 2.3-2 3-.4-2.6-1.7-5.3-4.3-7 .3 2.4-.5 4-1.8 5.7-1.1 1.5-2.3 3.2-2.3 5.6C4.5 18.4 8.1 21 12 21Z" />
    </svg>
  );
}

export function IconScale(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M8 9.5a8.5 8.5 0 0 1 8 0l-1.5 3" />
    </svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.2 7.2 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.07-.4.1-.8.1-1.2Z" />
    </svg>
  );
}

export function IconLogOut(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14" />
      <path d="M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5" />
    </svg>
  );
}

export function IconCloud(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 18.5a4.5 4.5 0 0 1-.4-9A5.5 5.5 0 0 1 17.3 10a4 4 0 0 1-.8 7.9Z" />
    </svg>
  );
}

export function IconHistory(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 12a8 8 0 1 1 2.3 5.7" />
      <path d="M4 13v-4h4" />
      <path d="M12 8v4.5l3 1.8" />
    </svg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13.5 6 9.5Z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </svg>
  );
}

/** Logotipo do Google em monocromo — usado no botão de login. */
export function IconGoogle({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M21.6 12.2c0-.7-.06-1.4-.18-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4Z"
      />
      <path
        fill="currentColor"
        opacity="0.75"
        d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z"
      />
      <path
        fill="currentColor"
        opacity="0.55"
        d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z"
      />
      <path
        fill="currentColor"
        opacity="0.9"
        d="M12 6c1.5 0 2.8.5 3.8 1.5L18.7 5A10 10 0 0 0 3.1 7.5L6.4 10C7.2 7.7 9.4 6 12 6Z"
      />
    </svg>
  );
}
