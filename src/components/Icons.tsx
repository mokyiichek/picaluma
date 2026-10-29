// Original line icons drawn for Picaluma (no third-party artwork).
import { CSSProperties } from "react";

type P = { size?: number; style?: CSSProperties; className?: string };
const svg = (size: number, children: React.ReactNode, p: P, vb = "0 0 24 24") => (
  <svg width={size} height={size} viewBox={vb} style={p.style} className={p.className} aria-hidden>
    {children}
  </svg>
);

export const FolderIcon = (p: P) =>
  svg(
    p.size ?? 16,
    <>
      <path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h5l2 2h10A1.5 1.5 0 0 1 22 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18z" fill="#f0c25a" stroke="#c9952b" strokeWidth="1" />
      <path d="M2 10h20v8a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18z" fill="#f7d77f" stroke="#c9952b" strokeWidth="1" />
    </>,
    p,
  );

export const PlayIcon = (p: P) => svg(p.size ?? 16, <path d="M7 4.5v15l12.5-7.5z" fill="#3a9a1c" stroke="#2a7311" strokeWidth="1" strokeLinejoin="round" />, p);

export const CollageIcon = (p: P) =>
  svg(
    p.size ?? 16,
    <>
      <rect x="3" y="5" width="11" height="9" fill="#6aa6de" stroke="#3a6f9f" />
      <rect x="9" y="9" width="12" height="10" fill="#f39a6b" stroke="#b5643c" />
    </>,
    p,
  );

export const MovieIcon = (p: P) =>
  svg(
    p.size ?? 16,
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" fill="#5f7fa8" stroke="#34506f" />
      {[7, 11, 15].map((y) => (
        <g key={y}>
          <rect x="4.5" y={y - 0.5} width="2" height="2" fill="#fff" />
          <rect x="17.5" y={y - 0.5} width="2" height="2" fill="#fff" />
        </g>
      ))}
    </>,
    p,
  );

export const StarIcon = ({ filled = true, ...p }: P & { filled?: boolean }) =>
  svg(
    p.size ?? 16,
    <path
      d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"
      fill={filled ? "#f6c218" : "none"}
      stroke={filled ? "#c49205" : "#9a9a9a"}
      strokeWidth="1.2"
      strokeLinejoin="round"
    />,
    p,
  );

export const SaveIcon = (p: P) =>
  svg(
    p.size ?? 16,
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" fill="#3d6fb6" stroke="#244a80" />
      <rect x="7" y="4" width="10" height="6" fill="#fff" />
      <rect x="6.5" y="13" width="11" height="7" fill="#dfe8f5" />
    </>,
    p,
  );

export const SearchIcon = (p: P) =>
  svg(
    p.size ?? 16,
    <>
      <circle cx="10" cy="10" r="6" fill="none" stroke="#555" strokeWidth="2" />
      <path d="m14.5 14.5 6 6" stroke="#555" strokeWidth="2.6" strokeLinecap="round" />
    </>,
    p,
  );

export const ClearIcon = (p: P) =>
  svg(
    p.size ?? 14,
    <>
      <circle cx="12" cy="12" r="9" fill="#d9534f" />
      <path d="m8.5 8.5 7 7m0-7-7 7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </>,
    p,
  );

export const ImportIcon = (p: P) =>
  svg(
    p.size ?? 18,
    <>
      <rect x="2.5" y="6" width="13" height="11" rx="1.5" fill="#888" stroke="#555" />
      <circle cx="9" cy="11.5" r="3" fill="#ddd" stroke="#555" />
      <path d="M17 11.5h5m-2.2-2.5 2.5 2.5-2.5 2.5" stroke="#333" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </>,
    p,
  );

export const ListFlatIcon = (p: P) =>
  svg(
    p.size ?? 16,
    <path d="M4 6h16M4 10h16M4 14h16M4 18h16" stroke="#3b5f8a" strokeWidth="1.8" strokeLinecap="round" />,
    p,
  );

export const ListTreeIcon = (p: P) =>
  svg(
    p.size ?? 16,
    <path d="M4 6h10M8 10h12M8 14h12M4 18h10M5 6v12" stroke="#555" strokeWidth="1.6" strokeLinecap="round" fill="none" />,
    p,
  );

export const WrenchIcon = (p: P) =>
  svg(p.size ?? 18, <path d="M14.5 3.5a5 5 0 0 0-4.8 6.4L3.5 16a2.1 2.1 0 0 0 3 3l6.1-6.2a5 5 0 0 0 6.4-4.8l-3 3-2.8-.8-.8-2.8z" fill="#444" />, p);

export const SunIcon = (p: P) =>
  svg(
    p.size ?? 18,
    <>
      <circle cx="12" cy="12" r="4" fill="#444" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return <path key={i} d={`M${12 + Math.cos(a) * 6.5} ${12 + Math.sin(a) * 6.5}L${12 + Math.cos(a) * 9.5} ${12 + Math.sin(a) * 9.5}`} stroke="#444" strokeWidth="2" strokeLinecap="round" />;
      })}
    </>,
    p,
  );

export const BrushIcon = ({ color = "#444", ...p }: P & { color?: string }) =>
  svg(
    p.size ?? 18,
    <>
      <path d="M20.5 3.5 11 13l-1.8-.2-.2-1.8 9.5-9.5z" fill={color} />
      <path d="M8.6 13.4c-2 0-3.6 1.6-3.6 3.6 0 1.2-.8 2.2-2 2.5 3.9 1.6 8.2-.3 7.6-4.8z" fill={color} />
    </>,
    p,
  );

export const ArrowIcon = ({ dir = "left", ...p }: P & { dir?: "left" | "right" }) =>
  svg(
    p.size ?? 22,
    <>
      <circle cx="12" cy="12" r="10" fill="#555" />
      <path d={dir === "left" ? "M13.5 7 8.5 12l5 5" : "M10.5 7l5 5-5 5"} stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>,
    p,
  );

export const BackIcon = (p: P) => svg(p.size ?? 16, <path d="M20 12H6m5-6-6 6 6 6" stroke="#2d5c8a" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />, p);

export const RotateIcon = ({ dir = "left", ...p }: P & { dir?: "left" | "right" }) =>
  svg(
    p.size ?? 16,
    <g transform={dir === "right" ? "matrix(-1 0 0 1 24 0)" : undefined}>
      <path d="M6.5 9.5A7 7 0 1 1 5 14" stroke="#555" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M3 5.5v5h5" stroke="#555" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>,
    p,
  );

export const PinIcon = (p: P) =>
  svg(
    p.size ?? 12,
    <>
      <path d="M12 2.5a6 6 0 0 0-6 6c0 4.5 6 13 6 13s6-8.5 6-13a6 6 0 0 0-6-6z" fill="#d21f1f" stroke="#8c0f0f" />
      <circle cx="12" cy="8.5" r="2.2" fill="#fff" />
    </>,
    p,
  );

export const PersonIcon = (p: P) =>
  svg(
    p.size ?? 18,
    <>
      <circle cx="12" cy="8" r="4" fill="#3b6ea5" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" fill="#3b6ea5" />
    </>,
    p,
  );

export const TagIcon = (p: P) =>
  svg(
    p.size ?? 18,
    <>
      <path d="M3 12V4h8l10 10-8 8z" fill="#e4b33f" stroke="#a57b16" />
      <circle cx="7.5" cy="8.5" r="1.6" fill="#fff" />
    </>,
    p,
  );

export const InfoIcon = (p: P) =>
  svg(
    p.size ?? 18,
    <>
      <circle cx="12" cy="12" r="9.5" fill="#24497a" />
      <path d="M12 10.5v7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="12" cy="7" r="1.5" fill="#fff" />
    </>,
    p,
  );

export const EmailIcon = (p: P) =>
  svg(
    p.size ?? 20,
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="1.5" fill="#fff" stroke="#555" strokeWidth="1.4" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" stroke="#555" strokeWidth="1.4" fill="none" />
    </>,
    p,
  );

export const PrintIcon = (p: P) =>
  svg(
    p.size ?? 20,
    <>
      <rect x="6.5" y="3.5" width="11" height="6" fill="#fff" stroke="#555" strokeWidth="1.4" />
      <rect x="3" y="9" width="18" height="8" rx="1.5" fill="#666" />
      <rect x="6.5" y="14" width="11" height="6.5" fill="#fff" stroke="#555" strokeWidth="1.4" />
    </>,
    p,
  );

export const ExportIcon = (p: P) =>
  svg(
    p.size ?? 20,
    <>
      <path d="M2.5 7.5a1.5 1.5 0 0 1 1.5-1.5h5l2 2h9a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z" fill="#5b4fa0" />
      <path d="M12 16.5v-6m-2.6 2.5L12 10.4l2.6 2.6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>,
    p,
  );

export const CloseIcon = (p: P) =>
  svg(
    p.size ?? 14,
    <>
      <circle cx="12" cy="12" r="9.5" fill="#fff" stroke="#666" />
      <path d="m8.5 8.5 7 7m0-7-7 7" stroke="#444" strokeWidth="2" strokeLinecap="round" />
    </>,
    p,
  );

export const CollapseIcon = ({ open = true, ...p }: P & { open?: boolean }) =>
  svg(
    p.size ?? 14,
    <>
      <circle cx="12" cy="12" r="10" fill="#7a8a99" />
      <path d={open ? "m7.5 10 4.5 4.5 4.5-4.5" : "m10 7.5 4.5 4.5-4.5 4.5"} stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>,
    p,
  );

export const PicturesIcon = (p: P) =>
  svg(
    p.size ?? 18,
    <>
      <rect x="2.5" y="5" width="15" height="12" fill="#cfe3f5" stroke="#4a7fb0" />
      <rect x="6.5" y="8" width="15" height="12" fill="#fff" stroke="#4a7fb0" />
      <path d="m8 18 4-4 3 3 2-2 3 3z" fill="#5f9c3a" />
    </>,
    p,
  );

export const HoldIcon = (p: P) =>
  svg(
    p.size ?? 14,
    <>
      <circle cx="12" cy="12" r="10" fill="#fff" stroke="#999" />
      <path d="M9.5 5.5h5l-1 4 2.5 2.5h-8l2.5-2.5zM12 12v7" stroke="#2f8a2f" strokeWidth="1.8" fill="#2f8a2f" strokeLinejoin="round" />
    </>,
    p,
  );

export const ClearSelIcon = (p: P) =>
  svg(
    p.size ?? 14,
    <>
      <circle cx="12" cy="12" r="10" fill="#fff" stroke="#999" />
      <circle cx="12" cy="12" r="5.5" fill="none" stroke="#c0392b" strokeWidth="2" />
    </>,
    p,
  );

/** Basic Fixes buttons in Edit view: one drawn icon per tool, as in Picasa (not the picture). */
export const FixIcon = ({ op, size = 30 }: { op: string; size?: number }) => {
  const frame = <rect x="4" y="6" width="24" height="20" rx="2" fill="#fff" stroke="#6b7a8a" strokeWidth="1.4" />;
  const icons: Record<string, React.ReactNode> = {
    crop: (
      <>
        <path d="M9 3v20h20" fill="none" stroke="#3b6ea5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3 9h20v20" fill="none" stroke="#5c5c5c" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    straighten: (
      <>
        {frame}
        <path d="M7 21 25 11" stroke="#3b6ea5" strokeWidth="2" strokeLinecap="round" />
        <path d="M6 16h20" stroke="#9aa6b2" strokeWidth="1" strokeDasharray="2 2" />
      </>
    ),
    redeye: (
      <>
        <path d="M3 16c4-6 9-8 13-8s9 2 13 8c-4 6-9 8-13 8s-9-2-13-8z" fill="#fff" stroke="#6b7a8a" strokeWidth="1.4" />
        <circle cx="16" cy="16" r="5" fill="#d8322a" />
        <circle cx="16" cy="16" r="2" fill="#2a2a2a" />
      </>
    ),
    lucky: (
      <>
        <circle cx="12" cy="12" r="5" fill="#52a447" />
        <circle cx="20" cy="12" r="5" fill="#52a447" />
        <circle cx="12" cy="20" r="5" fill="#52a447" />
        <circle cx="20" cy="20" r="5" fill="#52a447" />
        <path d="M16 16c2 4 3 8 6 11" fill="none" stroke="#3d7f35" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    autoContrast: (
      <>
        <circle cx="16" cy="16" r="11" fill="#fff" stroke="#5c5c5c" strokeWidth="1.6" />
        <path d="M16 5a11 11 0 0 1 0 22z" fill="#2f2f2f" />
      </>
    ),
    autoColor: (
      <>
        <circle cx="12" cy="13" r="7" fill="#e5463b" fillOpacity="0.85" />
        <circle cx="20" cy="13" r="7" fill="#46a64a" fillOpacity="0.85" />
        <circle cx="16" cy="20" r="7" fill="#3a78d1" fillOpacity="0.85" />
      </>
    ),
    retouch: (
      <>
        <path d="M6 26 20 12l4 4-14 14H6z" fill="#e9c46a" stroke="#8a6d2a" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M20 12l3-3a2 2 0 0 1 3 0l1 1a2 2 0 0 1 0 3l-3 3" fill="#c96a5a" stroke="#8a4a3e" strokeWidth="1.3" />
        <path d="M24 22l1.2 2.4L28 25l-2.4 1.2L25 29l-1.2-2.4L21 26l2.4-1.2z" fill="#3b6ea5" />
      </>
    ),
    text: (
      <>
        <path d="M7 7h18v4M16 7v19M12 26h8M7 7v4" fill="none" stroke="#3b6ea5" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      {icons[op] ?? frame}
    </svg>
  );
};
