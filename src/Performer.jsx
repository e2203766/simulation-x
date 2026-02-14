import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "./firebase";
import { onValue, ref } from "firebase/database";

const GLITCH_THRESHOLD = 30;

export default function Performer() {
  const [director, setDirector] = useState({ mode: "normal", autoRun: false });
  const [session, setSession] = useState({ state: "waiting", roundId: 0 });
  const [world, setWorld] = useState({ stability: 70, dominant: "stable", updatedAt: 0 });

  const [pulse, setPulse] = useState(0);
  const [reflash, setReflash] = useState(0); // for OVERRIDE "firmware" effect
  const lastUpdateRef = useRef(0);

  // director
  useEffect(() => {
    return onValue(ref(db, "director"), (snap) => {
      const d = snap.val();
      setDirector(d ? { mode: d.mode || "normal", autoRun: !!d.autoRun } : { mode: "normal", autoRun: false });
    });
  }, []);

  // session
  useEffect(() => {
    return onValue(ref(db, "session"), (snap) => {
      const s = snap.val() || { state: "waiting", roundId: 0 };
      setSession(s);
    });
  }, []);

  // world
  useEffect(() => {
    return onValue(ref(db, "world"), (snap) => {
      const w = snap.val();
      if (!w) return;
      setWorld({
        stability: w.stability ?? 70,
        dominant: w.dominant || "stable",
        updatedAt: w.updatedAt || 0,
      });
    });
  }, []);

  const blackout = director.mode === "blackout";
  const frozen = director.mode === "freeze" || session.state === "frozen";
  const active = session.state === "active";
  const locked = session.state === "locked";

  const stability = world.stability ?? 70;
  const glitchLow = stability < GLITCH_THRESHOLD;

  const dominant = (world.dominant || "stable").toLowerCase();

  // Trigger pulse on result applied (world.updatedAt changes)
  useEffect(() => {
    if (!world.updatedAt) return;

    // ignore duplicate
    if (world.updatedAt === lastUpdateRef.current) return;
    lastUpdateRef.current = world.updatedAt;

    setPulse((p) => p + 1);

    // extra "firmware reflash" when OVERRIDE just applied
    if (dominant === "override") {
      setReflash((x) => x + 1);
    }
  }, [world.updatedAt, dominant]);

  const theme = useMemo(() => {
    if (dominant === "glitch") return THEMES.glitch;
    if (dominant === "override") return THEMES.override;
    return THEMES.stable;
  }, [dominant]);

  const labelText = useMemo(() => {
    if (blackout) return "BLACKOUT";
    if (frozen) return "FROZEN";
    return dominant.toUpperCase();
  }, [blackout, frozen, dominant]);

  const hint = useMemo(() => {
    if (blackout) return "";
    if (frozen) return "SYSTEM PAUSED";
    if (active) return "AUDIENCE IS CHOOSING…";
    if (locked) return "WORLD UPDATED";
    return "WAITING FOR INPUT";
  }, [blackout, frozen, active, locked]);

  const cinematicPad = "clamp(28px, 5vw, 80px)";

  // GLITCH text styling knobs
  const glitchIntensity = useMemo(() => {
    // stronger if low stability + if active (chaos)
    let v = 0.35;
    if (dominant === "glitch") v += 0.25;
    if (glitchLow) v += 0.2;
    if (active) v += 0.1;
    return Math.min(1, v);
  }, [dominant, glitchLow, active]);

  return (
    <div style={{ ...ui.page, background: theme.bg, padding: cinematicPad }}>
      {/* cinematic vignette */}
      {!blackout && <div style={ui.vignette} />}

      {/* subtle film grain */}
      {!blackout && <div style={ui.grain} />}

      {/* Blackout: performer full black */}
      {blackout && <div style={ui.blackout} />}

      {/* low stability glitch overlay (not during blackout) */}
      {!blackout && glitchLow && (
        <>
          <div style={ui.glitch.noise} />
          <div style={ui.glitch.scanlines} />
        </>
      )}

      {/* OVERRIDE firmware reflash overlay (only when override updates) */}
      {!blackout && dominant === "override" && (
        <FirmwareReflash key={reflash} />
      )}

      {/* Top / cinematic header */}
      {!blackout && (
        <div style={ui.header}>
          {dominant === "glitch" && !frozen ? (
            <GlitchTitle text={labelText} intensity={glitchIntensity} />
          ) : (
            <div style={{ ...ui.title, borderColor: theme.border, background: theme.badgeBg }}>
              {labelText}
            </div>
          )}

          <div style={ui.hint}>{hint}</div>
        </div>
      )}

      {/* Center world model */}
      {!blackout && (
        <div style={ui.stageArea}>
          <WorldCore
            key={pulse}
            theme={theme}
            mode={dominant}
            active={active}
            locked={locked}
            glitchLow={glitchLow}
            stableBreath={dominant === "stable" && !frozen}
          />
        </div>
      )}

      {/* Footer minimal */}
      {!blackout && (
        <div style={ui.footer}>
          SIMULATION X • PERFORMER VIEW
        </div>
      )}
    </div>
  );
}

/* ---------- FX: GLITCH TITLE ---------- */

function GlitchTitle({ text, intensity = 0.6 }) {
  // Intensity drives jitter & split distances via CSS vars
  const split = 6 + Math.round(10 * intensity); // px
  const jitter = 0.8 + intensity * 1.8; // factor

  return (
    <div
      style={{
        ...ui.titleGlitchWrap,
        ["--sxSplit"]: `${split}px`,
        ["--sxJitter"]: `${jitter}`,
      }}
    >
      {/* base */}
      <div style={ui.titleGlitchBase}>{text}</div>

      {/* RGB ghosts */}
      <div style={{ ...ui.titleGlitchGhost, ...ui.titleGhostRed }}>{text}</div>
      <div style={{ ...ui.titleGlitchGhost, ...ui.titleGhostCyan }}>{text}</div>

      {/* slicing layer */}
      <div style={ui.titleGlitchSlices} aria-hidden="true">
        <span style={ui.sliceA}>{text}</span>
        <span style={ui.sliceB}>{text}</span>
        <span style={ui.sliceC}>{text}</span>
      </div>
    </div>
  );
}

/* ---------- FX: OVERRIDE "firmware reflash" ---------- */

function FirmwareReflash() {
  // a quick top-to-bottom scan + confirm flash
  return (
    <>
      <div style={ui.firmware.scan} />
      <div style={ui.firmware.flash} />
      <div style={ui.firmware.hud} />
    </>
  );
}

/* ---------- World Core ---------- */

function WorldCore({ theme, mode, active, locked, glitchLow, stableBreath }) {
  const symbol = mode === "glitch" ? "🌀" : mode === "override" ? "⚡" : "◉";

  const coreAnim = useMemo(() => {
    if (glitchLow) return "sxSpin 2.4s linear infinite, sxJitter 0.12s infinite";
    return "sxSpin 6s linear infinite";
  }, [glitchLow]);

  const breathAnim = stableBreath ? "sxBreath 3.8s ease-in-out infinite" : "none";

  return (
    <div style={ui.coreWrap}>
      {/* pulse ring */}
      <div style={{ ...ui.pulseRing, borderColor: theme.border }} />

      {/* orbit */}
      <div style={{ ...ui.orbit, borderColor: theme.border }} />

      {/* core */}
      <div style={{ ...ui.coreShell, animation: breathAnim }}>
        <div
          style={{
            ...ui.core,
            background: theme.coreBg,
            borderColor: theme.border,
            boxShadow: theme.shadow,
            animation: coreAnim,
          }}
        >
          <div style={{ ...ui.glass, background: theme.glass }} />

          {/* world silhouette */}
          <div style={ui.worldLayer}>
            {mode === "stable" && <StableWorld />}
            {mode === "glitch" && <GlitchWorld />}
            {mode === "override" && <OverrideWorld />}
          </div>

          {/* active fog */}
          {active && <div style={ui.fog} />}

          {/* locked flash */}
          {locked && <div style={ui.flash} />}

          {/* internal shimmer */}
          <div style={ui.shimmer} />
        </div>
      </div>

      {/* icon */}
      <div style={{ ...ui.symbol, color: theme.symbol }}>{symbol}</div>
    </div>
  );
}

/* ---------- World silhouettes ---------- */

function StableWorld() {
  return (
    <svg viewBox="0 0 400 400" style={ui.svg} aria-hidden="true">
      <defs>
        <linearGradient id="st_g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.78)" />
          <stop offset="1" stopColor="rgba(255,255,255,0.10)" />
        </linearGradient>
      </defs>

      <path
        d="M-10 280 C 60 230, 120 260, 180 240 C 230 224, 280 190, 420 240 L 420 420 L -10 420 Z"
        fill="url(#st_g)"
        opacity="0.78"
      />
      <path
        d="M-10 310 C 70 280, 130 318, 205 300 C 275 284, 320 250, 420 292 L 420 420 L -10 420 Z"
        fill="rgba(255,255,255,0.18)"
        opacity="0.92"
      />

      <g opacity="0.7" fill="rgba(255,255,255,0.34)">
        <rect x="80" y="190" width="18" height="78" rx="3" />
        <rect x="105" y="165" width="26" height="105" rx="4" />
        <rect x="138" y="205" width="16" height="62" rx="3" />
        <rect x="162" y="175" width="34" height="96" rx="4" />
        <rect x="202" y="210" width="18" height="58" rx="3" />
        <rect x="228" y="155" width="28" height="118" rx="4" />
        <rect x="264" y="200" width="18" height="70" rx="3" />
        <rect x="288" y="182" width="30" height="88" rx="4" />
      </g>

      <g opacity="0.5" fill="rgba(255,255,255,0.55)">
        <circle cx="92" cy="90" r="3" />
        <circle cx="140" cy="70" r="2" />
        <circle cx="280" cy="85" r="3" />
        <circle cx="320" cy="120" r="2.5" />
        <circle cx="220" cy="60" r="2.2" />
      </g>
    </svg>
  );
}

function GlitchWorld() {
  return (
    <svg viewBox="0 0 400 400" style={ui.svg} aria-hidden="true">
      <g opacity="0.55" stroke="rgba(255,255,255,0.35)" strokeWidth="2">
        {Array.from({ length: 9 }).map((_, i) => (
          <path
            key={i}
            d={`M ${40 + i * 40} 40 L ${30 + i * 40} 360`}
            strokeDasharray={i % 2 ? "9 7" : "14 10"}
          />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <path
            key={`h${i}`}
            d={`M 40 ${60 + i * 40} L 360 ${55 + i * 40}`}
            strokeDasharray={i % 2 ? "10 8" : "18 12"}
          />
        ))}
      </g>

      <g opacity="0.75" fill="rgba(255,255,255,0.20)">
        <rect x="80" y="120" width="90" height="22" />
        <rect x="210" y="90" width="110" height="18" />
        <rect x="110" y="210" width="150" height="26" />
        <rect x="70" y="270" width="120" height="20" />
        <rect x="215" y="260" width="95" height="22" />
      </g>

      <g opacity="0.55" fill="rgba(255,255,255,0.16)">
        <path d="M60 170 L170 170 L155 190 L60 190 Z" />
        <path d="M240 170 L340 170 L340 190 L258 190 Z" />
        <path d="M110 320 L240 320 L220 344 L110 344 Z" />
      </g>
    </svg>
  );
}

function OverrideWorld() {
  return (
    <svg viewBox="0 0 400 400" style={ui.svg} aria-hidden="true">
      <g opacity="0.55" stroke="rgba(255,255,255,0.42)" strokeWidth="7" strokeLinecap="round">
        <path d="M200 40 L200 120" />
        <path d="M200 280 L200 360" />
        <path d="M40 200 L120 200" />
        <path d="M280 200 L360 200" />
        <path d="M85 85 L140 140" />
        <path d="M260 260 L315 315" />
        <path d="M315 85 L260 140" />
        <path d="M140 260 L85 315" />
      </g>

      <g opacity="0.85" fill="rgba(255,255,255,0.26)">
        <circle cx="200" cy="200" r="78" />
        <circle cx="200" cy="200" r="44" />
      </g>

      <g opacity="0.75" fill="rgba(255,255,255,0.18)">
        <rect x="70" y="290" width="110" height="18" rx="8" />
        <rect x="220" y="290" width="110" height="18" rx="8" />
        <rect x="120" y="110" width="160" height="16" rx="8" />
      </g>
    </svg>
  );
}

/* ---------- Styles ---------- */

const ui = {
  page: {
    minHeight: "100vh",
    width: "100vw",
    overflow: "hidden",
    fontFamily: "system-ui",
    position: "relative",
  },

  vignette: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    background:
      "radial-gradient(circle at 50% 45%, rgba(0,0,0,0.00) 20%, rgba(0,0,0,0.18) 70%, rgba(0,0,0,0.35) 100%)",
    zIndex: 2,
  },

  grain: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    opacity: 0.10,
    mixBlendMode: "multiply",
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.35'/%3E%3C/svg%3E\")",
    backgroundRepeat: "repeat",
    animation: "sxGrain 1.1s steps(2) infinite",
    zIndex: 3,
  },

  header: {
    position: "relative",
    zIndex: 10,
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 18,
  },

  title: {
    padding: "14px 22px",
    borderRadius: 18,
    border: "4px solid rgba(0,0,0,0.12)",
    fontSize: "clamp(34px, 6vw, 72px)",
    fontWeight: 950,
    letterSpacing: "0.08em",
    color: "#0E1720",
    boxShadow: "0 22px 55px rgba(0,0,0,0.20)",
  },

  hint: {
    fontSize: "clamp(14px, 2vw, 22px)",
    fontWeight: 900,
    opacity: 0.78,
    letterSpacing: "0.14em",
    color: "#0E1720",
    textAlign: "right",
    marginTop: 10,
    whiteSpace: "nowrap",
  },

  stageArea: {
    minHeight: "calc(100vh - 180px)",
    display: "grid",
    placeItems: "center",
    position: "relative",
    zIndex: 6,
  },

  coreWrap: {
    width: "min(860px, 82vw)",
    aspectRatio: "1 / 1",
    display: "grid",
    placeItems: "center",
    position: "relative",
    transform: "translateY(clamp(0px, 1vw, 10px))",
  },

  coreShell: {
    width: "min(560px, 64vw)",
    aspectRatio: "1 / 1",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
  },

  core: {
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    border: "14px solid rgba(0,0,0,0.14)",
    position: "relative",
    overflow: "hidden",
  },

  glass: {
    position: "absolute",
    inset: 22,
    borderRadius: "50%",
    opacity: 0.9,
  },

  worldLayer: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    opacity: 0.95,
    transform: "scale(1.06)",
  },

  svg: {
    width: "86%",
    height: "86%",
    filter: "drop-shadow(0 14px 25px rgba(0,0,0,0.18))",
  },

  shimmer: {
    position: "absolute",
    inset: -80,
    background:
      "conic-gradient(from 90deg, rgba(255,255,255,0.0), rgba(255,255,255,0.10), rgba(255,255,255,0.0))",
    opacity: 0.45,
    mixBlendMode: "screen",
    animation: "sxShimmer 3.2s linear infinite",
  },

  fog: {
    position: "absolute",
    inset: -40,
    background:
      "radial-gradient(circle at 40% 35%, rgba(255,255,255,0.34), transparent 55%), radial-gradient(circle at 65% 60%, rgba(255,255,255,0.22), transparent 55%), radial-gradient(circle at 50% 50%, rgba(255,255,255,0.14), transparent 65%)",
    filter: "blur(10px)",
    opacity: 0.95,
    animation: "sxFog 2.2s ease-in-out infinite",
    mixBlendMode: "screen",
  },

  flash: {
    position: "absolute",
    inset: -50,
    background: "radial-gradient(circle, rgba(255,255,255,0.55), transparent 60%)",
    opacity: 0.85,
    animation: "sxFlash 550ms ease-out 1",
    mixBlendMode: "screen",
  },

  orbit: {
    position: "absolute",
    width: "min(720px, 80vw)",
    aspectRatio: "1 / 1",
    borderRadius: "50%",
    border: "5px dashed rgba(0,0,0,0.12)",
    opacity: 0.28,
    animation: "sxSpin 18s linear infinite reverse",
  },

  symbol: {
    position: "absolute",
    fontSize: "clamp(54px, 7vw, 96px)",
    fontWeight: 900,
    textShadow: "0 10px 26px rgba(0,0,0,0.22)",
    transform: "translateY(8px)",
    zIndex: 8,
  },

  pulseRing: {
    position: "absolute",
    width: "min(700px, 78vw)",
    aspectRatio: "1 / 1",
    borderRadius: "50%",
    border: "8px solid rgba(0,0,0,0.14)",
    opacity: 0,
    animation: "sxPulse 750ms ease-out 1",
    zIndex: 7,
  },

  footer: {
    position: "absolute",
    bottom: 18,
    left: 22,
    right: 22,
    textAlign: "center",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.28em",
    opacity: 0.55,
    color: "#0E1720",
    zIndex: 10,
  },

  blackout: {
    position: "fixed",
    inset: 0,
    background: "#000",
    opacity: 1,
    zIndex: 999,
  },

  glitch: {
    noise: {
      position: "fixed",
      inset: 0,
      pointerEvents: "none",
      opacity: 0.12,
      mixBlendMode: "multiply",
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.45'/%3E%3C/svg%3E\")",
      backgroundRepeat: "repeat",
      animation: "sxNoise 0.9s steps(2) infinite",
      zIndex: 50,
    },
    scanlines: {
      position: "fixed",
      inset: 0,
      pointerEvents: "none",
      opacity: 0.14,
      backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.18) 1px, rgba(0,0,0,0) 2px)",
      backgroundSize: "100% 6px",
      mixBlendMode: "multiply",
      animation: "sxScan 2.5s linear infinite",
      zIndex: 51,
    },
  },

  // OVERRIDE reflash overlays
  firmware: {
    scan: {
      position: "fixed",
      inset: 0,
      pointerEvents: "none",
      background:
        "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.0) 40%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.0) 60%, rgba(255,255,255,0) 100%)",
      opacity: 0,
      animation: "sxFirmwareScan 650ms ease-out 1",
      zIndex: 80,
      mixBlendMode: "screen",
    },
    flash: {
      position: "fixed",
      inset: 0,
      pointerEvents: "none",
      background: "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.55), rgba(255,255,255,0) 60%)",
      opacity: 0,
      animation: "sxFirmwareFlash 520ms ease-out 1",
      zIndex: 81,
      mixBlendMode: "screen",
    },
    hud: {
      position: "fixed",
      inset: 0,
      pointerEvents: "none",
      opacity: 0,
      background:
        "repeating-linear-gradient(90deg, rgba(255,255,255,0.12) 0, rgba(255,255,255,0.12) 1px, transparent 1px, transparent 26px)",
      animation: "sxFirmwareHud 650ms ease-out 1",
      zIndex: 82,
      mixBlendMode: "screen",
    },
  },

  // Glitch title layers
  titleGlitchWrap: {
    position: "relative",
    padding: "14px 22px",
    borderRadius: 18,
    border: "4px solid rgba(0,0,0,0.14)",
    background: "rgba(255,255,255,0.80)",
    boxShadow: "0 22px 55px rgba(0,0,0,0.20)",
    overflow: "hidden",
  },
  titleGlitchBase: {
    fontSize: "clamp(34px, 6vw, 72px)",
    fontWeight: 950,
    letterSpacing: "0.08em",
    color: "#0E1720",
    position: "relative",
    zIndex: 2,
    animation: "sxTitleJitter 0.22s infinite",
  },
  titleGlitchGhost: {
    position: "absolute",
    left: 22,
    top: 14,
    fontSize: "clamp(34px, 6vw, 72px)",
    fontWeight: 950,
    letterSpacing: "0.08em",
    opacity: 0.55,
    zIndex: 1,
    pointerEvents: "none",
  },
  titleGhostRed: {
    color: "rgba(255,0,120,0.75)",
    transform: "translateX(calc(var(--sxSplit) * -1))",
    mixBlendMode: "multiply",
  },
  titleGhostCyan: {
    color: "rgba(0,200,255,0.78)",
    transform: "translateX(var(--sxSplit))",
    mixBlendMode: "multiply",
  },
  titleGlitchSlices: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 3,
    opacity: 0.9,
    mixBlendMode: "multiply",
  },
  sliceA: {
    position: "absolute",
    left: 22,
    top: 14,
    fontSize: "clamp(34px, 6vw, 72px)",
    fontWeight: 950,
    letterSpacing: "0.08em",
    color: "rgba(0,0,0,0.70)",
    clipPath: "inset(0 0 66% 0)",
    transform: "translateX(calc(var(--sxSplit) * 0.35))",
    animation: "sxSlice 0.26s infinite",
  },
  sliceB: {
    position: "absolute",
    left: 22,
    top: 14,
    fontSize: "clamp(34px, 6vw, 72px)",
    fontWeight: 950,
    letterSpacing: "0.08em",
    color: "rgba(0,0,0,0.60)",
    clipPath: "inset(33% 0 33% 0)",
    transform: "translateX(calc(var(--sxSplit) * -0.25))",
    animation: "sxSlice 0.31s infinite reverse",
  },
  sliceC: {
    position: "absolute",
    left: 22,
    top: 14,
    fontSize: "clamp(34px, 6vw, 72px)",
    fontWeight: 950,
    letterSpacing: "0.08em",
    color: "rgba(0,0,0,0.52)",
    clipPath: "inset(66% 0 0 0)",
    transform: "translateX(calc(var(--sxSplit) * 0.15))",
    animation: "sxSlice 0.22s infinite",
  },
};

const THEMES = {
  stable: {
    bg:
      "radial-gradient(circle at 20% 10%, rgba(124,255,203,0.55), transparent 45%)," +
      "radial-gradient(circle at 80% 20%, rgba(125,182,255,0.45), transparent 50%)," +
      "radial-gradient(circle at 10% 80%, rgba(255,133,214,0.22), transparent 55%)," +
      "#F7FFEC",
    border: "rgba(0,0,0,0.14)",
    badgeBg: "rgba(255,255,255,0.82)",
    coreBg:
      "conic-gradient(from 0deg, rgba(124,255,203,0.95), rgba(125,182,255,0.95), rgba(255,133,214,0.80), rgba(124,255,203,0.95))",
    glass:
      "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.85), rgba(255,255,255,0.18) 52%, rgba(0,0,0,0.10) 100%)",
    shadow: "0 34px 95px rgba(0,0,0,0.25)",
    symbol: "#0E1720",
  },
  glitch: {
    bg:
      "radial-gradient(circle at 20% 10%, rgba(255,133,214,0.50), transparent 45%)," +
      "radial-gradient(circle at 80% 20%, rgba(125,182,255,0.55), transparent 50%)," +
      "radial-gradient(circle at 90% 85%, rgba(255,214,94,0.18), transparent 55%)," +
      "#FFF3FB",
    border: "rgba(0,0,0,0.16)",
    badgeBg: "rgba(255,255,255,0.80)",
    coreBg:
      "conic-gradient(from 20deg, rgba(255,133,214,0.92), rgba(125,182,255,0.95), rgba(255,214,94,0.82), rgba(255,133,214,0.92))",
    glass:
      "radial-gradient(circle at 60% 30%, rgba(255,255,255,0.82), rgba(255,255,255,0.14) 55%, rgba(0,0,0,0.12) 100%)",
    shadow: "0 40px 110px rgba(0,0,0,0.30)",
    symbol: "#0E1720",
  },
  override: {
    bg:
      "radial-gradient(circle at 20% 10%, rgba(255,214,94,0.60), transparent 45%)," +
      "radial-gradient(circle at 80% 20%, rgba(124,255,203,0.45), transparent 50%)," +
      "radial-gradient(circle at 20% 90%, rgba(125,182,255,0.20), transparent 55%)," +
      "#FFFBE6",
    border: "rgba(0,0,0,0.16)",
    badgeBg: "rgba(255,255,255,0.82)",
    coreBg:
      "conic-gradient(from 0deg, rgba(255,214,94,0.95), rgba(125,182,255,0.92), rgba(255,133,214,0.78), rgba(255,214,94,0.95))",
    glass:
      "radial-gradient(circle at 40% 30%, rgba(255,255,255,0.84), rgba(255,255,255,0.16) 55%, rgba(0,0,0,0.12) 100%)",
    shadow: "0 38px 105px rgba(0,0,0,0.28)",
    symbol: "#0E1720",
  },
};

// keyframes
if (typeof document !== "undefined" && !document.getElementById("sx-performer-wow-kf")) {
  const style = document.createElement("style");
  style.id = "sx-performer-wow-kf";
  style.textContent = `
    @keyframes sxSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes sxPulse { 0% { transform: scale(0.92); opacity: 0.7; } 100% { transform: scale(1.16); opacity: 0; } }
    @keyframes sxFlash { 0% { opacity: 0.0; } 25% { opacity: 1; } 100% { opacity: 0; } }
    @keyframes sxFog { 0%,100% { transform: translateY(0) scale(1); opacity: .86; } 50% { transform: translateY(-6px) scale(1.03); opacity: 1; } }
    @keyframes sxJitter { 0%{ transform: translate(0,0) rotate(0deg);} 25%{ transform: translate(-1px,1px) rotate(0.4deg);} 50%{ transform: translate(1px,-1px) rotate(-0.4deg);} 75%{ transform: translate(1px,1px) rotate(0.3deg);} 100%{ transform: translate(0,0) rotate(0deg);} }
    @keyframes sxNoise {
      0% { transform: translate3d(0,0,0); }
      25% { transform: translate3d(-2%, 1%, 0); }
      50% { transform: translate3d(1%, -1%, 0); }
      75% { transform: translate3d(2%, 2%, 0); }
      100% { transform: translate3d(0,0,0); }
    }
    @keyframes sxScan { 0% { transform: translateY(0); } 100% { transform: translateY(6px); } }
    @keyframes sxShimmer { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes sxGrain { 0% { transform: translate3d(0,0,0); } 50% { transform: translate3d(-1%,1%,0); } 100% { transform: translate3d(0,0,0); } }

    /* STABLE breathing */
    @keyframes sxBreath {
      0%,100% { transform: scale(1); filter: drop-shadow(0 24px 70px rgba(0,0,0,0.10)); }
      50% { transform: scale(1.02); filter: drop-shadow(0 28px 86px rgba(0,0,0,0.16)); }
    }

    /* GLITCH title */
    @keyframes sxTitleJitter {
      0% { transform: translate(0,0); }
      25% { transform: translate(calc(var(--sxJitter) * -0.6px), calc(var(--sxJitter) * 0.4px)); }
      50% { transform: translate(calc(var(--sxJitter) * 0.5px), calc(var(--sxJitter) * -0.5px)); }
      75% { transform: translate(calc(var(--sxJitter) * 0.7px), calc(var(--sxJitter) * 0.3px)); }
      100% { transform: translate(0,0); }
    }
    @keyframes sxSlice {
      0% { opacity: .85; transform: translateX(calc(var(--sxSplit) * 0.2)); }
      50% { opacity: 1; transform: translateX(calc(var(--sxSplit) * -0.25)); }
      100% { opacity: .9; transform: translateX(calc(var(--sxSplit) * 0.1)); }
    }

    /* OVERRIDE firmware scan */
    @keyframes sxFirmwareScan {
      0% { opacity: 0; transform: translateY(-20%); }
      20% { opacity: 1; }
      100% { opacity: 0; transform: translateY(20%); }
    }
    @keyframes sxFirmwareFlash {
      0% { opacity: 0; }
      25% { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes sxFirmwareHud {
      0% { opacity: 0; transform: translateY(-3%); }
      30% { opacity: 0.55; }
      100% { opacity: 0; transform: translateY(3%); }
    }
  `;
  document.head.appendChild(style);
}
