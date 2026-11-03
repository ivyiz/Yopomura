import { useRef } from "react";

let pageArtIdCounter = 0;
function usePageArtId() {
    const ref = useRef<string>();
    if (!ref.current) {
        pageArtIdCounter = (pageArtIdCounter + 1) % 1000000;
        ref.current = `p_${pageArtIdCounter}`;
    }
    return ref.current;
}

function rng(seed: number) {
    let a = (seed * 2654435761) >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const W = 700;
const H = 1000;
const M = 36;
const G = 14;

type Panel = { x: number; y: number; w: number; h: number };

function layout(r: () => number): Panel[] {
    const rows = 3 + Math.floor(r() * 2);
    const total = H - M * 2 - G * (rows - 1);
    const ws = Array.from({ length: rows }, () => 0.7 + r() * 0.6);
    const sum = ws.reduce((a, b) => a + b, 0);
    const out: Panel[] = [];
    let y = M;
    ws.forEach((wt) => {
        const h = (wt / sum) * total;
        const cols = 1 + Math.floor(r() * 3);
        const cw = W - M * 2 - G * (cols - 1);
        const parts = Array.from({ length: cols }, () => 0.6 + r());
        const ps = parts.reduce((a, b) => a + b, 0);
        let x = M;
        parts.forEach((p) => {
            const w = (p / ps) * cw;
            out.push({ x, y, w, h });
            x += w + G;
        });
        y += h + G;
    });
    return out;
}

export default function PageArt({ n }: { n: number }) {
    const uid = usePageArtId();
    const r = rng(n + 7);
    const panels = layout(r);

    return (
        <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ display: "block", width: "100%", height: "100%" }}
            preserveAspectRatio="xMidYMid slice"
        >
            <title>Page artwork placeholder</title>
            <defs>
                <pattern
                    id={`dots${uid}`}
                    width="7"
                    height="7"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(30)"
                >
                    <circle cx="3.5" cy="3.5" r="1.4" fill="#111" />
                </pattern>
                <pattern
                    id={`hatch${uid}`}
                    width="6"
                    height="6"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                >
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#222" strokeWidth="1.2" />
                </pattern>
                {panels.map((p, i) => (
                    <clipPath id={`c${uid}${i}`} key={i}>
                        <rect x={p.x} y={p.y} width={p.w} height={p.h} />
                    </clipPath>
                ))}
            </defs>
            <rect width={W} height={H} fill="#f6f4ee" />
            {panels.map((p, i) => {
                const kind = Math.floor(r() * 4);
                const cx = p.x + p.w * (0.3 + r() * 0.4);
                const cy = p.y + p.h * (0.3 + r() * 0.4);
                const lines = Array.from({ length: 46 }, (_, k) => {
                    const a = (k / 46) * Math.PI * 2 + r() * 0.05;
                    const len = 600;
                    return (
                        <line
                            key={k}
                            x1={cx + Math.cos(a) * (30 + r() * 60)}
                            y1={cy + Math.sin(a) * (30 + r() * 60)}
                            x2={cx + Math.cos(a) * len}
                            y2={cy + Math.sin(a) * len}
                            stroke="#111"
                            strokeWidth={0.6 + r() * 1.6}
                        />
                    );
                });
                const bx = p.x + p.w * (0.15 + r() * 0.4);
                const by = p.y + 14;
                return (
                    <g key={i}>
                        <g clipPath={`url(#c${uid}${i})`}>
                            <rect
                                x={p.x}
                                y={p.y}
                                width={p.w}
                                height={p.h}
                                fill={kind === 1 ? "#e9e6dd" : "#fbfaf6"}
                            />
                            {kind === 0 && lines}
                            {kind === 1 && (
                                <rect
                                    x={p.x}
                                    y={p.y + p.h * 0.45}
                                    width={p.w}
                                    height={p.h}
                                    fill={`url(#dots${uid})`}
                                />
                            )}
                            {kind === 2 && (
                                <rect
                                    x={p.x}
                                    y={p.y}
                                    width={p.w}
                                    height={p.h}
                                    fill={`url(#hatch${uid})`}
                                    opacity=".55"
                                />
                            )}
                            {kind === 3 && (
                                <path
                                    d={`M${p.x} ${p.y + p.h} L${p.x} ${p.y + p.h * 0.7} Q${p.x + p.w * 0.5} ${p.y + p.h * 0.4} ${p.x + p.w} ${p.y + p.h * 0.75} L${p.x + p.w} ${p.y + p.h}Z`}
                                    fill="#161616"
                                />
                            )}
                            <ellipse
                                cx={cx}
                                cy={cy + p.h * 0.22}
                                rx={p.w * 0.2}
                                ry={p.h * 0.28}
                                fill="#fff"
                                stroke="#111"
                                strokeWidth="3"
                            />
                            <path
                                d={`M${cx - p.w * 0.2} ${cy + p.h * 0.1} Q${cx} ${cy - p.h * 0.08} ${cx + p.w * 0.2} ${cy + p.h * 0.1} Q${cx + p.w * 0.1} ${cy - p.h * 0.1} ${cx} ${cy - p.h * 0.12} Q${cx - p.w * 0.1} ${cy - p.h * 0.1} ${cx - p.w * 0.2} ${cy + p.h * 0.1}Z`}
                                fill="#111"
                            />
                            <circle
                                cx={cx - p.w * 0.07}
                                cy={cy + p.h * 0.2}
                                r={Math.min(p.w, p.h) * 0.025}
                                fill="#111"
                            />
                            <circle
                                cx={cx + p.w * 0.07}
                                cy={cy + p.h * 0.2}
                                r={Math.min(p.w, p.h) * 0.025}
                                fill="#111"
                            />
                            {r() > 0.4 && p.w > 150 && (
                                <g>
                                    <ellipse
                                        cx={bx + 55}
                                        cy={by + 28}
                                        rx="55"
                                        ry="28"
                                        fill="#fff"
                                        stroke="#111"
                                        strokeWidth="2.5"
                                    />
                                    <rect x={bx + 22} y={by + 18} width="66" height="4" rx="2" fill="#999" />
                                    <rect x={bx + 30} y={by + 28} width="50" height="4" rx="2" fill="#999" />
                                    <rect x={bx + 38} y={by + 38} width="34" height="4" rx="2" fill="#999" />
                                </g>
                            )}
                        </g>
                        <rect
                            x={p.x}
                            y={p.y}
                            width={p.w}
                            height={p.h}
                            fill="none"
                            stroke="#111"
                            strokeWidth="3.5"
                        />
                    </g>
                );
            })}
            <text
                x={W / 2}
                y={H - 12}
                textAnchor="middle"
                fontSize="14"
                fill="#666"
                fontFamily="Inter, sans-serif"
            >
                {n}
            </text>
        </svg>
    );
}
