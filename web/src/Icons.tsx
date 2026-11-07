// Line icons for each kind of reading. 24×24 grid, drawn with currentColor so they follow the theme.

export type IconName =
  | 'thermometer'
  | 'wind'
  | 'gauge'
  | 'rain'
  | 'sun'
  | 'home'
  | 'bolt'
  | 'leaf'
  | 'sensor'
  | 'droplet'
  | 'dew'
  | 'arrowUp'
  | 'arrowDown'
  | 'gust'
  | 'compass'
  | 'battery'
  | 'feels';

const PATHS: Record<IconName, JSX.Element> = {
  thermometer: (
    <>
      <path d="M14 14.76V4.5a2.5 2.5 0 0 0-5 0v10.26a4.5 4.5 0 1 0 5 0Z" />
      <path d="M11.5 9v8" />
      <circle cx="11.5" cy="17.5" r="1.25" fill="currentColor" />
    </>
  ),
  wind: (
    <>
      <path d="M3 8h9.5a2.5 2.5 0 1 0-2.5-2.5" />
      <path d="M3 12h14.5a2.5 2.5 0 1 1-2.5 2.5" />
      <path d="M3 16h7" />
    </>
  ),
  gauge: (
    <>
      <path d="M4.5 17a8.5 8.5 0 1 1 15 0" />
      <path d="m12 14 3.5-4.5" />
      <circle cx="12" cy="14.5" r="1.25" fill="currentColor" />
      <path d="M6.5 11.5h1M12 6.5v1M16.5 11.5h1" />
    </>
  ),
  rain: (
    <>
      <path d="M7 14.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 7.5a3.5 3.5 0 0 1 .5 7Z" />
      <path d="m8.5 17.5-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  home: (
    <>
      <path d="m3.5 11 8.5-7 8.5 7" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  bolt: <path d="M13 2.5 5 13.5h6l-1 8 8-11h-6Z" />,
  leaf: (
    <>
      <path d="M5 19C5 10.5 10.5 5 19.5 4.5 19.5 13 14 19 5.5 19.5" />
      <path d="M5 19.5 12 12.5" />
    </>
  ),
  sensor: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6" />
      <path d="M5.3 18.7a9.5 9.5 0 0 1 0-13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4" />
    </>
  ),
  droplet: <path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z" />,
  dew: (
    <>
      <path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z" />
      <path d="M9 15.5a3 3 0 0 0 3 2.5" />
    </>
  ),
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  gust: (
    <>
      <path d="M3 9h11a3 3 0 1 0-3-3" />
      <path d="M3 13h16a3 3 0 1 1-3 3" />
      <path d="M3 17h5M3 5h4" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5Z" />
    </>
  ),
  battery: (
    <>
      <rect x="3" y="7.5" width="16" height="9" rx="2" />
      <path d="M21 10.5v3M6 10.5v3" />
    </>
  ),
  feels: (
    <>
      <circle cx="12" cy="5" r="2" />
      <path d="M12 8v6M8.5 10.5h7M12 14l-3 6M12 14l3 6" />
    </>
  ),
};

export function Icon({ name, size = 18, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
