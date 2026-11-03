import { useRef } from "react";

let frameIdCounter = 0;
function useFrameId() {
    const ref = useRef<string>();
    if (!ref.current) {
        frameIdCounter = (frameIdCounter + 1) % 1000000;
        ref.current = `f_${frameIdCounter}`;
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

function ridge(r: () => number, base: number, amp: number) {
    let d = `M0 900 L0 ${base}`;
    for (let x = 0; x <= 1600; x += 100) d += ` L${x} ${base - r() * amp}`;
    return `${d} L1600 900Z`;
}

export default function Frame({
    seed,
    h1,
    h2,
    ratio = "xMidYMid slice",
}: {
    seed: number;
    h1: number;
    h2: number;
    ratio?: string;
    drift?: boolean;
}) {
    const id = useFrameId();
    const r = rng(seed * 13 + 5);
    const sx = 300 + r() * 1000;
    const sy = 220 + r() * 220;
    const stars = Array.from({ length: 40 }, () => [r() * 1600, r() * 380, 0.6 + r() * 1.4]);

    return (
        <svg
            viewBox="0 0 1600 900"
            preserveAspectRatio={ratio}
            style={{ display: "block", width: "100%", height: "100%" }}
        >
            <title>Decorative cover frame</title>
            <defs>
                <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={`hsl(${h1} 60% 8%)`} />
                    <stop offset=".6" stopColor={`hsl(${h2} 55% 22%)`} />
                    <stop offset="1" stopColor={`hsl(${h1} 70% 38%)`} />
                </linearGradient>
                <radialGradient id={`g${id}`}>
                    <stop offset="0" stopColor={`hsl(${h2} 100% 85%)`} stopOpacity=".95" />
                    <stop offset=".25" stopColor={`hsl(${h2} 100% 70%)`} stopOpacity=".35" />
                    <stop offset="1" stopColor={`hsl(${h2} 100% 60%)`} stopOpacity="0" />
                </radialGradient>
            </defs>
            <rect width="1600" height="900" fill={`url(#s${id})`} />
            {stars.map(([x, y, s], i) => (
                <circle key={i} cx={x} cy={y} r={s} fill="#fff" opacity=".6" />
            ))}
            <g>
                <circle cx={sx} cy={sy} r="320" fill={`url(#g${id})`} />
                <circle cx={sx} cy={sy} r="46" fill={`hsl(${h2} 100% 92%)`} />
            </g>
            <path d={ridge(r, 560, 120)} fill={`hsl(${h1} 45% 16%)`} opacity=".85" />
            <path d={ridge(r, 680, 140)} fill={`hsl(${h1} 45% 10%)`} opacity=".95" />
            <path d={ridge(r, 790, 110)} fill="var(--v2-bg, #05050A)" />
            <rect y="780" width="1600" height="120" fill="var(--v2-bg, #05050A)" opacity=".4" />
        </svg>
    );
}
