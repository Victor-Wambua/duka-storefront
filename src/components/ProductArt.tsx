import { useId, type ReactNode } from 'react';
import type { ArtSpec } from '../types';

/**
 * Product pictures are drawn in code: no image files, no network. Each shape
 * is a small SVG composition on a 200 x 200 canvas, coloured from the
 * product's palette (or the chosen colour variant).
 */

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Blend a hex colour toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const ch = (v: number) => clampByte(v + (target - v) * t);
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Rough relative luminance (0 dark, 1 light) of a #rrggbb colour. */
function lightness(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

interface P {
  c1: string;
  c2: string;
  c3: string;
  label?: string;
  sublabel?: string;
  /** gradient ids */
  body: string;
  dark: string;
  shine: string;
}

function LabelPanel({ x, y, w, h, p, size = 17 }: { x: number; y: number; w: number; h: number; p: P; size?: number }): ReactNode {
  if (!p.label) return null;
  // Shrink long words to sit inside the panel, but never below 12 units: the lettering is
  // part of the picture, and anything smaller would not be legible at any size.
  // Lettering on the cream label must stay readable even when the palette colour is pale.
  const ink = lightness(p.c2) > 0.5 ? shade(p.c3, -0.35) : lightness(p.c2) > 0.38 ? shade(p.c2, -0.3) : p.c2;
  const room = w - 10;
  const fit = Math.max(12, Math.min(size, Math.floor((room / (p.label.length * 0.72)) * 10) / 10));
  // If a long word still does not fit at 12 units, squeeze the letters rather than shrink them.
  const squeeze = p.label.length * 0.72 * fit > room;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={3} fill="#fffdf6" opacity={0.96} />
      <rect x={x} y={y + h - 6} width={w} height={6} rx={0} fill={p.c3} />
      <text x={x + w / 2} y={y + h / 2 - 3 + fit * 0.35} textAnchor="middle" fontSize={fit} fontWeight={800} fill={ink} fontFamily="system-ui, sans-serif" {...(squeeze ? { textLength: room, lengthAdjust: 'spacingAndGlyphs' as const } : {})}>
        {p.label}
      </text>
    </g>
  );
}

const Shine = ({ d, p }: { d: string; p: P }) => <path d={d} fill={`url(#${p.shine})`} />;

function Bag({ p }: { p: P }) {
  const size = (p.label?.length ?? 0) > 7 ? 13 : 17;
  return (
    <g>
      <path d="M50 50 Q100 38 150 50 L158 166 Q100 182 42 166 Z" fill={`url(#${p.body})`} />
      <path d="M50 50 Q100 38 150 50 L151 62 Q100 52 49 62 Z" fill={p.c2} opacity={0.85} />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1={54 + i * 8} y1={47 + Math.sin(i) * 0.4} x2={54 + i * 8} y2={60} stroke={p.c1} strokeOpacity={0.5} strokeWidth={1.5} />
      ))}
      <LabelPanel x={66} y={86} w={68} h={62} p={p} size={size} />
      <Shine d="M52 66 L60 164 Q52 160 46 162 L44 70 Z" p={p} />
    </g>
  );
}

function Bottle({ p }: { p: P }) {
  return (
    <g>
      <rect x={88} y={36} width={24} height={20} rx={4} fill={p.c2} />
      <rect x={90} y={40} width={20} height={3} fill="#fff" opacity={0.3} />
      <path d="M90 56 H110 V66 Q134 76 134 100 V164 Q134 174 124 174 H76 Q66 174 66 164 V100 Q66 76 90 66 Z" fill={`url(#${p.body})`} />
      <LabelPanel x={68} y={102} w={64} h={52} p={p} size={(p.label?.length ?? 0) > 6 ? 12 : 15} />
      <Shine d="M74 88 Q72 76 90 70 L90 168 Q80 170 74 164 Z" p={p} />
    </g>
  );
}

function Tin({ p }: { p: P }) {
  return (
    <g>
      <path d="M58 64 V162 A42 12 0 0 0 142 162 V64 Z" fill={`url(#${p.body})`} />
      <ellipse cx={100} cy={64} rx={42} ry={12} fill={p.c2} />
      <ellipse cx={100} cy={64} rx={34} ry={8} fill={`url(#${p.dark})`} />
      <ellipse cx={100} cy={64} rx={42} ry={12} fill="none" stroke="#fff" strokeOpacity={0.5} strokeWidth={1.5} />
      <LabelPanel x={59} y={88} w={82} h={56} p={p} size={(p.label?.length ?? 0) > 6 ? 14 : 17} />
      <Shine d="M62 70 L72 160 Q64 156 58 152 L58 70 Z" p={p} />
    </g>
  );
}

function Box({ p }: { p: P }) {
  return (
    <g>
      <path d="M58 50 H140 V172 H58 Z" fill={`url(#${p.body})`} />
      <path d="M140 50 L160 40 V162 L140 172 Z" fill={p.c2} />
      <path d="M58 50 L78 40 H160 L140 50 Z" fill={p.c1} />
      <path d="M58 50 L78 40 H160 L140 50 Z" fill="#fff" opacity={0.32} />
      <LabelPanel x={64} y={84} w={70} h={62} p={p} size={(p.label?.length ?? 0) > 6 ? 13 : 17} />
      <Shine d="M60 56 L70 168 L58 170 L58 56 Z" p={p} />
    </g>
  );
}

function Carton({ p }: { p: P }) {
  return (
    <g>
      <path d="M66 74 H134 V172 H66 Z" fill={`url(#${p.body})`} />
      <path d="M134 74 L150 66 V164 L134 172 Z" fill={p.c2} opacity={0.9} />
      <path d="M66 74 L100 48 L134 74 Z" fill={p.c2} />
      <path d="M134 74 L100 48 L116 42 L150 66 Z" fill={p.c1} opacity={0.85} />
      <rect x={96} y={42} width={8} height={8} fill={p.c2} />
      <LabelPanel x={70} y={92} w={60} h={62} p={p} size={(p.label?.length ?? 0) > 6 ? 12 : 15} />
      <Shine d="M68 80 L76 168 L66 170 L66 80 Z" p={p} />
    </g>
  );
}

function Jar({ p }: { p: P }) {
  return (
    <g>
      <rect x={62} y={58} width={76} height={24} rx={6} fill={p.c2} />
      <rect x={62} y={58} width={76} height={5} rx={2} fill="#fff" opacity={0.25} />
      <rect x={56} y={80} width={88} height={94} rx={22} fill={`url(#${p.body})`} />
      <rect x={56} y={80} width={88} height={14} rx={7} fill="#fff" opacity={0.22} />
      <LabelPanel x={68} y={106} w={64} h={46} p={p} size={(p.label?.length ?? 0) > 6 ? 13 : 16} />
      <Shine d="M66 96 Q60 120 64 160 Q70 166 76 164 L72 100 Z" p={p} />
    </g>
  );
}

function Tube({ p }: { p: P }) {
  return (
    <g transform="rotate(-20 100 110)">
      <rect x={28} y={92} width={30} height={34} rx={5} fill={p.c3} />
      <rect x={28} y={92} width={30} height={5} rx={2} fill="#fff" opacity={0.35} />
      <path d="M56 98 L64 90 H150 V128 H64 L56 120 Z" fill={`url(#${p.body})`} />
      <path d="M150 90 H166 V128 H150 Z" fill={p.c2} />
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} x1={152 + i * 3} y1={92} x2={152 + i * 3} y2={126} stroke="#fff" strokeOpacity={0.3} strokeWidth={1} />
      ))}
      <rect x={72} y={96} width={72} height={26} rx={4} fill="#fffdf6" opacity={0.96} />
      <rect x={72} y={116} width={72} height={6} fill={p.c3} />
      {p.label && (
        <text x={108} y={112} textAnchor="middle" fontSize={14} fontWeight={800} fill={p.c2} fontFamily="system-ui, sans-serif">
          {p.label}
        </text>
      )}
      <Shine d="M64 94 H150 V101 H64 Z" p={p} />
    </g>
  );
}

function Soap({ p }: { p: P }) {
  return (
    <g>
      <g transform="rotate(8 100 110)">
        <rect x={52} y={62} width={96} height={52} rx={14} fill={p.c2} opacity={0.55} />
      </g>
      <g transform="rotate(-9 100 120)">
        <rect x={42} y={92} width={116} height={60} rx={16} fill={p.c2} />
        <rect x={42} y={88} width={116} height={60} rx={16} fill={`url(#${p.body})`} />
        <rect x={52} y={98} width={96} height={40} rx={10} fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={2} />
        {p.label && (
          <text x={100} y={123} textAnchor="middle" fontSize={17} fontWeight={800} fill="#fff" fontFamily="system-ui, sans-serif" letterSpacing={1.5}>
            {p.label}
          </text>
        )}
        <rect x={42} y={88} width={116} height={14} rx={10} fill="#fff" opacity={0.2} />
      </g>
    </g>
  );
}

function Roll({ p }: { p: P }) {
  const roll = (cx: number, top: number) => (
    <g>
      <path d={`M${cx - 36} ${top} V${top + 66} A36 11 0 0 0 ${cx + 36} ${top + 66} V${top} Z`} fill={`url(#${p.body})`} />
      <rect x={cx - 36} y={top + 34} width={72} height={9} fill={p.c3} opacity={0.9} />
      <ellipse cx={cx} cy={top} rx={36} ry={11} fill="#fff" />
      <ellipse cx={cx} cy={top} rx={36} ry={11} fill="none" stroke={p.c2} strokeOpacity={0.25} />
      <ellipse cx={cx} cy={top} rx={12} ry={4.5} fill={p.c2} opacity={0.85} />
    </g>
  );
  return (
    <g>
      {roll(76, 70)}
      {roll(128, 92)}
    </g>
  );
}

function Pot({ p }: { p: P }) {
  return (
    <g>
      <rect x={34} y={104} width={20} height={9} rx={4.5} fill={p.c2} />
      <rect x={146} y={104} width={20} height={9} rx={4.5} fill={p.c2} />
      <path d="M50 94 H150 L142 160 Q140 172 128 172 H72 Q60 172 58 160 Z" fill={`url(#${p.body})`} />
      <path d="M46 92 Q100 66 154 92 L150 100 H50 Z" fill={`url(#${p.dark})`} />
      <path d="M52 94 Q100 72 148 94" fill="none" stroke="#fff" strokeOpacity={0.6} strokeWidth={2} />
      <rect x={92} y={60} width={16} height={10} rx={4} fill={p.c3} />
      <Shine d="M58 100 L64 160 Q62 168 66 170 L56 160 Z" p={p} />
    </g>
  );
}

function Bucket({ p }: { p: P }) {
  return (
    <g>
      <path d="M52 84 Q100 40 148 84" fill="none" stroke={p.c2} strokeWidth={5} strokeLinecap="round" />
      <path d="M52 84 H148 L136 162 Q134 172 124 172 H76 Q66 172 64 162 Z" fill={`url(#${p.body})`} />
      <ellipse cx={100} cy={84} rx={48} ry={11} fill={p.c1} />
      <ellipse cx={100} cy={85} rx={42} ry={8} fill={`url(#${p.dark})`} />
      <rect x={60} y={108} width={80} height={6} fill="#fff" opacity={0.18} />
      <Shine d="M56 92 L64 160 Q70 168 72 168 L62 100 Z" p={p} />
    </g>
  );
}

function Mug({ p }: { p: P }) {
  return (
    <g>
      <path d="M126 92 H138 Q158 92 158 116 Q158 140 138 140 H124" fill="none" stroke={p.c2} strokeWidth={9} strokeLinecap="round" />
      <rect x={56} y={68} width={74} height={104} rx={10} fill={`url(#${p.body})`} />
      <rect x={56} y={68} width={74} height={12} rx={6} fill="#fffdf6" />
      <rect x={56} y={74} width={74} height={4} fill={p.c2} opacity={0.18} />
      <ellipse cx={93} cy={70} rx={36} ry={5} fill={p.c2} opacity={0.9} />
      <Shine d="M62 86 H72 V164 Q64 164 62 158 Z" p={p} />
    </g>
  );
}

function Plates({ p }: { p: P }) {
  const plate = (cy: number) => (
    <g>
      <ellipse cx={100} cy={cy + 6} rx={64} ry={17} fill={p.c2} opacity={0.35} />
      <ellipse cx={100} cy={cy} rx={64} ry={17} fill={`url(#${p.body})`} />
      <ellipse cx={100} cy={cy} rx={50} ry={12} fill="none" stroke={p.c3} strokeWidth={3} />
      <ellipse cx={100} cy={cy + 1} rx={40} ry={8.5} fill={p.c2} opacity={0.1} />
    </g>
  );
  return (
    <g>
      {plate(146)}
      {plate(124)}
      {plate(102)}
    </g>
  );
}

function Spoon({ p }: { p: P }) {
  return (
    <g transform="rotate(32 100 100)">
      <rect x={93} y={14} width={14} height={118} rx={7} fill={`url(#${p.body})`} />
      <ellipse cx={100} cy={154} rx={29} ry={34} fill={`url(#${p.body})`} />
      <ellipse cx={100} cy={156} rx={20} ry={25} fill={p.c2} opacity={0.35} />
      <rect x={93} y={20} width={14} height={8} rx={4} fill={p.c3} opacity={0.55} />
      <line x1={99} y1={40} x2={99} y2={120} stroke={p.c2} strokeOpacity={0.25} strokeWidth={1.5} />
      <line x1={104} y1={52} x2={104} y2={110} stroke={p.c2} strokeOpacity={0.2} strokeWidth={1.2} />
    </g>
  );
}

function Flask({ p }: { p: P }) {
  return (
    <g>
      <rect x={76} y={36} width={48} height={32} rx={8} fill={p.c2} />
      <rect x={76} y={36} width={48} height={5} rx={2} fill="#fff" opacity={0.25} />
      <rect x={70} y={64} width={60} height={110} rx={16} fill={`url(#${p.body})`} />
      <rect x={70} y={96} width={60} height={8} fill={p.c3} opacity={0.9} />
      <rect x={70} y={128} width={60} height={4} fill={p.c3} opacity={0.5} />
      <Shine d="M76 74 H86 V166 Q78 166 76 160 Z" p={p} />
    </g>
  );
}

function Basket({ p }: { p: P }) {
  const rows = [116, 130, 144, 158];
  return (
    <g>
      <path d="M58 98 Q100 22 142 98" fill="none" stroke={p.c2} strokeWidth={8} strokeLinecap="round" />
      <path d="M44 98 H156 L142 164 Q140 174 130 174 H70 Q60 174 58 164 Z" fill={`url(#${p.body})`} />
      {rows.map((y) => (
        <path key={y} d={`M${46 + (y - 98) * 0.1} ${y} Q100 ${y + 7} ${154 - (y - 98) * 0.1} ${y}`} fill="none" stroke={p.c2} strokeOpacity={0.45} strokeWidth={1.6} />
      ))}
      {Array.from({ length: 9 }, (_, i) => (
        <line key={i} x1={54 + i * 11.5} y1={100} x2={58 + i * 10.5} y2={172} stroke={p.c2} strokeOpacity={0.22} strokeWidth={1.4} />
      ))}
      <path d="M48 104 H152 V112 H48 Z" fill={p.c2} />
      <path d="M52 124 l7 -9 l7 9 l7 -9 l7 9 l7 -9 l7 9 l7 -9 l7 9 l7 -9 l7 9 l7 -9 l7 9 l7 -9 l7 9" fill="none" stroke={p.c3} strokeWidth={3} strokeLinejoin="round" transform="translate(-2 4)" />
    </g>
  );
}

function Textile({ p, uid }: { p: P; uid: string }) {
  const pat = `${uid}-pat`;
  return (
    <g>
      <defs>
        <pattern id={pat} width={16} height={16} patternUnits="userSpaceOnUse">
          <path d="M8 2 L13 8 L8 14 L3 8 Z" fill={p.c3} opacity={0.9} />
          <circle cx={0} cy={0} r={2} fill={p.c3} opacity={0.7} />
          <circle cx={16} cy={16} r={2} fill={p.c3} opacity={0.7} />
        </pattern>
      </defs>
      <rect x={50} y={52} width={108} height={80} rx={5} fill={p.c2} transform="rotate(5 100 92)" />
      <rect x={38} y={84} width={124} height={84} rx={5} fill={`url(#${p.body})`} />
      <rect x={46} y={92} width={108} height={68} rx={3} fill="none" stroke={p.c3} strokeWidth={3} />
      <rect x={52} y={98} width={96} height={56} fill={`url(#${pat})`} opacity={0.85} />
      <rect x={38} y={84} width={124} height={84} rx={5} fill={`url(#${p.shine})`} opacity={0.7} />
      <path d="M38 168 q62 10 124 0" fill="none" stroke="#000" strokeOpacity={0.08} strokeWidth={6} />
    </g>
  );
}

const SHAPES: Record<ArtSpec['shape'], (p: P, uid: string) => ReactNode> = {
  bag: (p) => <Bag p={p} />,
  bottle: (p) => <Bottle p={p} />,
  tin: (p) => <Tin p={p} />,
  box: (p) => <Box p={p} />,
  carton: (p) => <Carton p={p} />,
  jar: (p) => <Jar p={p} />,
  tube: (p) => <Tube p={p} />,
  soap: (p) => <Soap p={p} />,
  roll: (p) => <Roll p={p} />,
  pot: (p) => <Pot p={p} />,
  bucket: (p) => <Bucket p={p} />,
  mug: (p) => <Mug p={p} />,
  plates: (p) => <Plates p={p} />,
  spoon: (p) => <Spoon p={p} />,
  flask: (p) => <Flask p={p} />,
  basket: (p) => <Basket p={p} />,
  textile: (p, uid) => <Textile p={p} uid={uid} />,
};

export function ProductArt({ art, tint, className }: { art: ArtSpec; tint?: string | undefined; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const base = tint ?? art.colors[0];
  const c2 = tint ? shade(tint, -0.3) : art.colors[1];
  const c3 = art.colors[2];
  const p: P = {
    c1: base,
    c2,
    c3,
    ...(art.label ? { label: art.label } : {}),
    ...(art.sublabel ? { sublabel: art.sublabel } : {}),
    body: `${uid}b`,
    dark: `${uid}d`,
    shine: `${uid}s`,
  };
  return (
    <div className={`art ${className ?? ''}`} style={{ ['--art' as string]: base }}>
      <svg viewBox="0 0 200 200" role="img" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={p.body} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={shade(base, 0.18)} />
            <stop offset="0.45" stopColor={base} />
            <stop offset="1" stopColor={shade(base, -0.22)} />
          </linearGradient>
          <linearGradient id={p.dark} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={shade(c2, -0.2)} />
            <stop offset="1" stopColor={c2} />
          </linearGradient>
          <linearGradient id={p.shine} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity={0.5} />
            <stop offset="1" stopColor="#fff" stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* backdrop: soft sun and a few kitenge-style motifs */}
        <circle cx={100} cy={96} r={76} fill={base} opacity={0.14} />
        <circle cx={100} cy={96} r={58} fill={base} opacity={0.1} />
        <g fill={c3} opacity={0.35}>
          <path d="M22 28 l7 7 l-7 7 l-7 -7 Z" />
          <path d="M178 160 l7 7 l-7 7 l-7 -7 Z" />
          <circle cx={176} cy={34} r={4} />
          <circle cx={26} cy={168} r={4} />
        </g>
        <ellipse cx={100} cy={176} rx={56} ry={7} fill="#000" opacity={0.16} />
        {SHAPES[art.shape](p, uid)}
      </svg>
    </div>
  );
}
