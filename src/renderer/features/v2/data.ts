export type Video = {
    id: number;
    title: string;
    ep: string;
    format: ".mp4" | ".mkv";
    size: string;
    res: "1080p" | "4K" | "720p";
    dur: number;
    progress: number;
    h1: number;
    h2: number;
};

export const VIDEOS: Video[] = [
    {
        id: 1,
        title: "Neon Meridian",
        ep: "S1 • E04 — Static Bloom",
        format: ".mkv",
        size: "2.4 GB",
        res: "4K",
        dur: 1440,
        progress: 1122,
        h1: 205,
        h2: 285,
    },
    {
        id: 2,
        title: "The Salt Orchard",
        ep: "S2 • E09 — Low Tide",
        format: ".mp4",
        size: "1.2 GB",
        res: "1080p",
        dur: 2625,
        progress: 640,
        h1: 20,
        h2: 330,
    },
    {
        id: 3,
        title: "Afterglow Protocol",
        ep: "S1 • E01 — Cold Boot",
        format: ".mkv",
        size: "3.1 GB",
        res: "4K",
        dur: 1815,
        progress: 905,
        h1: 265,
        h2: 190,
    },
    {
        id: 4,
        title: "Paper Lanterns",
        ep: "Feature Film",
        format: ".mkv",
        size: "6.8 GB",
        res: "4K",
        dur: 6420,
        progress: 0,
        h1: 35,
        h2: 5,
    },
    {
        id: 5,
        title: "Hollow Signal",
        ep: "S3 • E02 — Dead Air",
        format: ".mp4",
        size: "980 MB",
        res: "1080p",
        dur: 1425,
        progress: 0,
        h1: 170,
        h2: 230,
    },
    {
        id: 6,
        title: "Glass Harbor",
        ep: "S1 • E07 — The Pier",
        format: ".mp4",
        size: "1.1 GB",
        res: "1080p",
        dur: 1380,
        progress: 0,
        h1: 195,
        h2: 160,
    },
    {
        id: 7,
        title: "Midnight Cartographer",
        ep: "S1 • E12 — Finale",
        format: ".mkv",
        size: "4.2 GB",
        res: "4K",
        dur: 2880,
        progress: 0,
        h1: 300,
        h2: 240,
    },
    {
        id: 8,
        title: "Velvet Static",
        ep: "S2 • E03 — Feedback",
        format: ".mp4",
        size: "720 MB",
        res: "720p",
        dur: 1290,
        progress: 0,
        h1: 330,
        h2: 270,
    },
    {
        id: 9,
        title: "Orbit of Small Things",
        ep: "Documentary",
        format: ".mkv",
        size: "5.3 GB",
        res: "4K",
        dur: 3510,
        progress: 0,
        h1: 250,
        h2: 210,
    },
    {
        id: 10,
        title: "Ember Line",
        ep: "S1 • E05 — Smoke Signals",
        format: ".mp4",
        size: "1.3 GB",
        res: "1080p",
        dur: 1425,
        progress: 0,
        h1: 15,
        h2: 40,
    },
    {
        id: 11,
        title: "Blue Hour Radio",
        ep: "S4 • E08 — Request Line",
        format: ".mkv",
        size: "1.9 GB",
        res: "1080p",
        dur: 1500,
        progress: 0,
        h1: 215,
        h2: 320,
    },
    {
        id: 12,
        title: "The Quiet Engine",
        ep: "S1 • E02 — Idle",
        format: ".mp4",
        size: "1.0 GB",
        res: "1080p",
        dur: 1395,
        progress: 0,
        h1: 140,
        h2: 200,
    },
];

export const fmt = (s: number) => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = h ? String(m).padStart(2, "0") : String(m);
    return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
};

export const chaptersFor = (v: Video) =>
    ["Opening", "Cold Open", "The Turn", "Aftermath", "Credits"].map((title, i) => ({
        title,
        at: i === 0 ? 0 : Math.floor(v.dur * [0, 0.08, 0.33, 0.62, 0.93][i]),
    }));
