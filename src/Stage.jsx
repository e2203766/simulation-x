import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "./firebase";
import { onValue, ref, remove, set, get, update } from "firebase/database";

const ACTIVE_SECONDS = 20;
const LOCKED_SECONDS = 6;
const WAIT_SECONDS = 8; // пауза между раундами при auto-run
const GLITCH_THRESHOLD = 30;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function getOrCreateStageId() {
  const key = "sx_stage_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id =
      crypto?.randomUUID?.() ||
      `stage_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function dominantFromScores({ stable, glitch, override }) {
  const max = Math.max(stable, glitch, override);
  if (glitch === max) return "glitch";
  if (override === max) return "override";
  return "stable";
}

function calcDelta({ stable, glitch, override }) {
  return stable * 1 + glitch * -2 + override * -3;
}

export default function Stage() {
  const stageId = useMemo(() => getOrCreateStageId(), []);
  const timersRef = useRef({ autoStart: null, lock: null, unlock: null });

  const [session, setSessionState] = useState({
    state: "waiting", // waiting | active | locked | frozen
    roundId: 0,
    endsAt: 0,
    nextStartsAt: 0,
    controllerId: "",
  });

  const [director, setDirector] = useState({
    mode: "normal", // normal | freeze | blackout
    autoRun: false,
  });

  const [scores, setScores] = useState({ stable: 0, glitch: 0, override: 0 });
  const [total, setTotal] = useState(0);

  const [world, setWorld] = useState({ stability: 70, dominant: "stable" });
  const [now, setNow] = useState(Date.now());

  // ticker
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  // session listener
  useEffect(() => {
    const sessionRef = ref(db, "session");
    return onValue(sessionRef, (snap) => {
      setSessionState(
        snap.val() || {
          state: "waiting",
          roundId: 0,
          endsAt: 0,
          nextStartsAt: 0,
          controllerId: "",
        }
      );
    });
  }, []);

  // director listener
  useEffect(() => {
    const dRef = ref(db, "director");
    return onValue(dRef, (snap) => {
      const d = snap.val();
      if (d) setDirector({ mode: d.mode || "normal", autoRun: !!d.autoRun });
      else setDirector({ mode: "normal", autoRun: false });
    });
  }, []);

  // world listener
  useEffect(() => {
    const worldRef = ref(db, "world");
    return onValue(worldRef, (snap) => {
      const w = snap.val();
      if (w?.stability !== undefined) {
        setWorld({
          stability: w.stability,
          dominant: w.dominant || "stable",
        });
      }
    });
  }, []);

  // votes listener for current round
  useEffect(() => {
    if (!session.roundId) {
      setScores({ stable: 0, glitch: 0, override: 0 });
      setTotal(0);
      return;
    }
    const votesRef = ref(db, `votes/${session.roundId}`);
    return onValue(votesRef, (snap) => {
      const data = snap.val() || {};
      let stable = 0,
        glitch = 0,
        override = 0;

      for (const k in data) {
        const type = data[k]?.type;
        const power = Number(data[k]?.power || 1);
        if (type === "stable") stable += power;
        if (type === "glitch") glitch += power;
        if (type === "override") override += power;
      }

      const t = stable + glitch + override;
      setScores({ stable, glitch, override });
      setTotal(t);
    });
  }, [session.roundId]);

  const secondsLeft = useMemo(() => {
    const ms = (session?.endsAt || 0) - now;
    return Math.max(0, Math.ceil(ms / 1000));
  }, [session, now]);

  const startsIn = useMemo(() => {
    const ms = (session?.nextStartsAt || 0) - now;
    return Math.max(0, Math.ceil(ms / 1000));
  }, [session, now]);

  const dominantLive = useMemo(() => {
    if (!total) return "waiting";
    return dominantFromScores(scores);
  }, [scores, total]);

  const glitchMode = world.stability < GLITCH_THRESHOLD;
  const blackoutMode = director.mode === "blackout"; // индикатор + отключение glitch overlay
  const bgState = dominantLive === "waiting" ? "waiting" : dominantLive;

  // ---------- TIMER CLEANUP ----------
  const clearTimers = () => {
    const t = timersRef.current;
    if (t.autoStart) clearTimeout(t.autoStart);
    if (t.lock) clearTimeout(t.lock);
    if (t.unlock) clearTimeout(t.unlock);
    timersRef.current = { autoStart: null, lock: null, unlock: null };
  };

  useEffect(() => {
    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- CONTROLLER CLAIM ----------
  useEffect(() => {
    (async () => {
      const snap = await get(ref(db, "session/controllerId"));
      const current = snap.exists() ? snap.val() : "";
      if (!current) {
        await update(ref(db, "session"), { controllerId: stageId });
      }
    })();
  }, [stageId]);

  const iAmController = session.controllerId === stageId || !session.controllerId;

  // ---------- AUTO-RUN SCHEDULER ----------
  useEffect(() => {
    clearTimers();

    if (!director.autoRun) return;
    if (director.mode !== "normal") return;
    if (!iAmController) return;
    if (session.state !== "waiting") return;

    const needNew = !session.nextStartsAt || session.nextStartsAt <= Date.now();
    const nextStartsAt = needNew
      ? Date.now() + WAIT_SECONDS * 1000
      : session.nextStartsAt;

    if (needNew) {
      update(ref(db, "session"), { nextStartsAt, endsAt: 0 });
    }

    const delay = Math.max(0, nextStartsAt - Date.now());

    timersRef.current.autoStart = setTimeout(() => {
      startRoundAuto();
    }, delay);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    director.autoRun,
    director.mode,
    session.state,
    session.nextStartsAt,
    session.controllerId,
  ]);

  const ensureWorldInit = async () => {
    const wSnap = await get(ref(db, "world/stability"));
    if (!wSnap.exists()) {
      await set(ref(db, "world"), {
        stability: 70,
        dominant: "stable",
        updatedAt: Date.now(),
        roundId: 0,
      });
    }
    const dSnap = await get(ref(db, "director"));
    if (!dSnap.exists()) {
      await set(ref(db, "director"), { mode: "normal", autoRun: false });
    }
  };

  // ---------- ROUND LOGIC ----------
  const startRound = async ({ reason }) => {
    await ensureWorldInit();

    const dModeSnap = await get(ref(db, "director/mode"));
    const mode = dModeSnap.exists() ? dModeSnap.val() : "normal";
    if (mode !== "normal") return;

    const controllerSnap = await get(ref(db, "session/controllerId"));
    const ctrl = controllerSnap.exists() ? controllerSnap.val() : "";
    if (ctrl && ctrl !== stageId) return;

    const currentRound = session.roundId || 0;
    const nextRound = currentRound + 1;

    await remove(ref(db, `votes/${nextRound}`));

    const endsAt = Date.now() + ACTIVE_SECONDS * 1000;
    await set(ref(db, "session"), {
      state: "active",
      roundId: nextRound,
      endsAt,
      nextStartsAt: 0,
      controllerId: stageId,
      startedBy: reason,
      updatedAt: Date.now(),
    });

    timersRef.current.lock = setTimeout(async () => {
      const snap = await get(ref(db, `votes/${nextRound}`));
      const data = snap.val() || {};

      let stable = 0,
        glitch = 0,
        override = 0;

      for (const k in data) {
        const type = data[k]?.type;
        const power = Number(data[k]?.power || 1);
        if (type === "stable") stable += power;
        if (type === "glitch") glitch += power;
        if (type === "override") override += power;
      }

      const dom = dominantFromScores({ stable, glitch, override });
      const delta = calcDelta({ stable, glitch, override });

      const wNow = await get(ref(db, "world/stability"));
      const current = wNow.exists() ? wNow.val() : 70;
      const nextStability = clamp(current + delta, 0, 100);

      await set(ref(db, "world"), {
        stability: nextStability,
        dominant: dom,
        updatedAt: Date.now(),
        roundId: nextRound,
        lastDelta: delta,
        lastScores: { stable, glitch, override },
      });

      const lockedEnds = Date.now() + LOCKED_SECONDS * 1000;
      await set(ref(db, "session"), {
        state: "locked",
        roundId: nextRound,
        endsAt: lockedEnds,
        nextStartsAt: 0,
        controllerId: stageId,
        updatedAt: Date.now(),
      });

      timersRef.current.unlock = setTimeout(async () => {
        await set(ref(db, "session"), {
          state: "waiting",
          roundId: nextRound,
          endsAt: 0,
          nextStartsAt: 0,
          controllerId: stageId,
          updatedAt: Date.now(),
        });
      }, LOCKED_SECONDS * 1000);
    }, ACTIVE_SECONDS * 1000);
  };

  const startRoundAuto = async () => startRound({ reason: "auto" });
  const startRoundManual = async () => startRound({ reason: "manual" });

  // ---------- DIRECTOR CONTROLS ----------
  const setAutoRun = async (value) => {
    await ensureWorldInit();
    await update(ref(db, "director"), { autoRun: value });
    if (value) {
      await update(ref(db, "session"), { state: "waiting" });
    }
  };

  const freeze = async () => {
    await ensureWorldInit();
    clearTimers();
    await set(ref(db, "director"), { ...director, mode: "freeze" });
    await update(ref(db, "session"), {
      state: "frozen",
      endsAt: 0,
      nextStartsAt: 0,
      controllerId: stageId,
      updatedAt: Date.now(),
    });
  };

  const blackout = async () => {
    await ensureWorldInit();
    clearTimers();
    await set(ref(db, "director"), { ...director, mode: "blackout" });
    await update(ref(db, "session"), {
      state: "frozen",
      endsAt: 0,
      nextStartsAt: 0,
      controllerId: stageId,
      updatedAt: Date.now(),
    });
  };

  const resume = async () => {
    await ensureWorldInit();
    await set(ref(db, "director"), { ...director, mode: "normal" });
    await update(ref(db, "session"), {
      state: "waiting",
      endsAt: 0,
      nextStartsAt: 0,
      controllerId: stageId,
      updatedAt: Date.now(),
    });
  };

  const restart = async () => {
    clearTimers();
    await remove(ref(db, "votes"));
    await set(ref(db, "world"), {
      stability: 70,
      dominant: "stable",
      updatedAt: Date.now(),
      roundId: 0,
    });
    await set(ref(db, "director"), {
      mode: "normal",
      autoRun: director.autoRun || false,
    });
    await set(ref(db, "session"), {
      state: "waiting",
      roundId: 0,
      endsAt: 0,
      nextStartsAt: 0,
      controllerId: stageId,
      updatedAt: Date.now(),
    });
  };

  const resetCurrentVotes = async () => {
    if (!session.roundId) return;
    await remove(ref(db, `votes/${session.roundId}`));
  };

  // --- UI helpers ---
  const hintLines = [
    "Auto-run: schedules rounds automatically (WAIT → ACTIVE → LOCKED).",
    "Manual Start: launches a new round right now.",
    "Freeze: pauses the system (no voting, no timers).",
    "Blackout: hides the Audience UI (Stage stays visible).",
    "Resume: returns to NORMAL and continues workflow.",
    "Restart: resets world + session (votes cleared).",
  ];

  return (
    <div style={{ ...ui.page, ...ui.bg[bgState] }}>
      {/* ✅ Blackout overlay на Stage НЕТ. Blackout только на Audience */}

      {/* Glitch overlay (only when stability low, and not blackout) */}
      {!blackoutMode && glitchMode && (
        <>
          <div style={ui.glitch.noiseLayer} />
          <div style={ui.glitch.scanlines} />
        </>
      )}

      <div style={ui.shell}>
        <header style={ui.header}>
          <div>
            <div style={ui.kicker}>SIMULATION CONTROL</div>
            <h1 style={ui.h1}>
              Stage Dashboard{" "}
              {blackoutMode ? (
                <span style={ui.badgeDark}>BLACKOUT</span>
              ) : director.mode === "freeze" ? (
                <span style={ui.badgeLight}>FROZEN</span>
              ) : glitchMode ? (
                <span style={ui.badgeWarn}>INSTABILITY</span>
              ) : (
                <span style={ui.badgeOk}>NORMAL</span>
              )}
            </h1>
          </div>

          <div style={ui.smallMeta}>
            <div>
              <b>Controller:</b> {iAmController ? "YES" : "NO"}{" "}
              <span style={ui.mini}>({stageId.slice(0, 6)}…)</span>
            </div>
            <div>
              <b>Director:</b> {director.mode.toUpperCase()} • <b>Auto-run:</b>{" "}
              {director.autoRun ? "ON" : "OFF"}
            </div>
          </div>
        </header>

        <div style={ui.grid}>
          {/* LEFT CARD */}
          <section style={ui.card}>
            <div style={ui.cardTitle}>Round & Voting</div>

            <div style={ui.row}>
              <div style={ui.label}>Round</div>
              <div style={ui.value}>{session.roundId || "-"}</div>
            </div>

            <div style={ui.row}>
              <div style={ui.label}>Session</div>
              <div style={ui.value}>
                {session.state?.toUpperCase() || "WAITING"}
                {session.state === "active" ? ` • ends in ${secondsLeft}s` : ""}
                {session.state === "locked" ? ` • showing ${secondsLeft}s` : ""}
                {session.state === "waiting" &&
                director.autoRun &&
                director.mode === "normal" &&
                session.nextStartsAt
                  ? ` • next in ${startsIn}s`
                  : ""}
              </div>
            </div>

            <div style={ui.row}>
              <div style={ui.label}>Dominant (live)</div>
              <div style={ui.value}>{dominantLive.toUpperCase()}</div>
            </div>

            <div style={ui.sep} />

            <div style={ui.barsWrap}>
              <Bar label="Stable" value={scores.stable} total={total} />
              <Bar label="Glitch" value={scores.glitch} total={total} />
              <Bar label="Override" value={scores.override} total={total} />
            </div>

            <div style={{ ...ui.mini, marginTop: 10 }}>
              Total points (round {session.roundId || "-"}): <b>{total}</b>
            </div>
          </section>

          {/* RIGHT CARD */}
          <section style={ui.card}>
            <div style={ui.cardTitle}>World Core</div>

            <div style={ui.dialWrap}>
              <StabilityDial
                value={world.stability}
                dominant={world.dominant || "stable"}
                deltaHint={glitchMode ? "⚠ low stability" : "🟢 stable-ish"}
              />
              <div style={ui.dialMeta}>
                <div style={ui.bigLine}>
                  Dominant: <b>{(world.dominant || "stable").toUpperCase()}</b>
                </div>
                <div style={ui.bigLine}>
                  Stability: <b>{world.stability}/100</b>
                </div>
                <div style={ui.mini}>
                  Tip: make it drop below <b>{GLITCH_THRESHOLD}</b> to trigger glitch visuals.
                </div>
              </div>
            </div>

            <div style={ui.sep} />

            <div style={ui.cardTitle}>Director Quick Guide</div>
            <div style={ui.hints}>
              {hintLines.map((t) => (
                <div key={t} style={ui.hintLine}>
                  {t}
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* CONTROLS */}
        <section style={{ ...ui.card, marginTop: 14 }}>
          <div style={ui.cardTitle}>Controls</div>

          <div style={ui.controls}>
            <ActionButton
              onClick={() => setAutoRun(!director.autoRun)}
              variant="primary"
              text={`Auto-run: ${director.autoRun ? "Turn OFF" : "Turn ON"}`}
            />

            <ActionButton
              onClick={startRoundManual}
              variant="primary"
              text="Manual Start Round"
              disabled={!iAmController || director.mode !== "normal"}
            />

            <ActionButton onClick={freeze} variant="ghost" text="Freeze" />
            <ActionButton onClick={blackout} variant="ghost" text="Blackout" />
            <ActionButton onClick={resume} variant="ghost" text="Resume" />

            <ActionButton
              onClick={resetCurrentVotes}
              variant="ghost"
              text="Reset Current Round Votes"
            />

            <ActionButton
              onClick={restart}
              variant="danger"
              text="Restart (Reset World/Session)"
            />
          </div>

          <div style={{ ...ui.mini, marginTop: 10 }}>
            Keep Stage open on the control laptop. Audience uses /audience.
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------- UI Components ---------- */

function Bar({ label, value, total }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={ui.barTop}>
        <span style={ui.barLabel}>{label}</span>
        <span style={ui.barValue}>
          {value} ({pct}%)
        </span>
      </div>

      <div style={ui.barTrack}>
        <div style={{ ...ui.barFill, width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StabilityDial({ value, dominant, deltaHint }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const pct = clamp(value, 0, 100);
  const dash = (pct / 100) * c;

  const emoji =
    dominant === "glitch" ? "🌀" : dominant === "override" ? "⚡" : "🟢";

  return (
    <div style={ui.dialCard}>
      <svg width="140" height="140" viewBox="0 0 140 140" style={{ display: "block" }}>
        <defs>
          <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7CFFCB" />
            <stop offset="0.5" stopColor="#7DB6FF" />
            <stop offset="1" stopColor="#FF85D6" />
          </linearGradient>

          <filter id="soft">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.25" />
          </filter>
        </defs>

        <circle cx="70" cy="70" r={r} stroke="rgba(0,0,0,0.10)" strokeWidth="14" fill="none" />
        <circle
          cx="70"
          cy="70"
          r={r}
          stroke="url(#ring)"
          strokeWidth="14"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform="rotate(-90 70 70)"
          filter="url(#soft)"
        />

        <circle cx="70" cy="70" r="44" fill="rgba(255,255,255,0.85)" />

        <text x="70" y="66" textAnchor="middle" style={ui.dialTextBig}>
          {pct}
        </text>
        <text x="70" y="84" textAnchor="middle" style={ui.dialTextSmall}>
          stability
        </text>
      </svg>

      <div style={ui.dialFooter}>
        <div style={ui.dialEmoji}>{emoji}</div>
        <div style={ui.dialHint}>{deltaHint}</div>
      </div>
    </div>
  );
}

function ActionButton({ text, onClick, disabled, variant }) {
  const base = ui.btn.base;
  const v =
    variant === "primary"
      ? ui.btn.primary
      : variant === "danger"
      ? ui.btn.danger
      : ui.btn.ghost;

  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...v, ...(disabled ? ui.btn.disabled : {}) }}>
      {text}
    </button>
  );
}

/* ---------- Styles ---------- */

const ui = {
  page: {
    minHeight: "100vh",
    padding: 18,
    fontFamily: "system-ui",
  },

  // playful backgrounds (like your reference image vibe)
  bg: {
    waiting: {
      background:
        "radial-gradient(circle at 20% 10%, rgba(255,214,94,0.55), transparent 45%), radial-gradient(circle at 80% 20%, rgba(124,255,203,0.45), transparent 50%), radial-gradient(circle at 20% 90%, rgba(125,182,255,0.45), transparent 55%), radial-gradient(circle at 90% 90%, rgba(255,133,214,0.38), transparent 55%), #F7FFEC",
    },
    stable: {
      background:
        "radial-gradient(circle at 20% 10%, rgba(124,255,203,0.55), transparent 45%), radial-gradient(circle at 80% 20%, rgba(125,182,255,0.45), transparent 50%), #F7FFEC",
    },
    glitch: {
      background:
        "radial-gradient(circle at 20% 10%, rgba(255,133,214,0.45), transparent 45%), radial-gradient(circle at 80% 20%, rgba(125,182,255,0.45), transparent 50%), #FFF3FB",
    },
    override: {
      background:
        "radial-gradient(circle at 20% 10%, rgba(255,214,94,0.55), transparent 45%), radial-gradient(circle at 80% 20%, rgba(124,255,203,0.45), transparent 50%), #FFFBE6",
    },
  },

  shell: {
    maxWidth: 1100,
    margin: "0 auto",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 16,
    marginBottom: 14,
  },

  kicker: {
    letterSpacing: "0.22em",
    fontSize: 12,
    opacity: 0.65,
    fontWeight: 700,
  },

  h1: {
    margin: "6px 0 0 0",
    fontSize: 48,
    lineHeight: 1.05,
    color: "#1C2B39",
  },

  badgeOk: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(124,255,203,0.45)",
    border: "2px solid rgba(0,0,0,0.12)",
    verticalAlign: "middle",
    marginLeft: 10,
  },
  badgeWarn: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,214,94,0.55)",
    border: "2px solid rgba(0,0,0,0.12)",
    verticalAlign: "middle",
    marginLeft: 10,
  },
  badgeLight: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(125,182,255,0.45)",
    border: "2px solid rgba(0,0,0,0.12)",
    verticalAlign: "middle",
    marginLeft: 10,
  },
  badgeDark: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(0,0,0,0.12)",
    border: "2px solid rgba(0,0,0,0.12)",
    verticalAlign: "middle",
    marginLeft: 10,
  },

  smallMeta: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "#1C2B39",
    opacity: 0.9,
    textAlign: "right",
  },

  mini: { fontSize: 12, opacity: 0.65 },

  grid: {
    display: "grid",
    gridTemplateColumns: "1.05fr 0.95fr",
    gap: 14,
  },

  card: {
    background: "rgba(255,255,255,0.75)",
    border: "2px solid rgba(0,0,0,0.12)",
    borderRadius: 18,
    padding: 16,
    boxShadow: "0 10px 24px rgba(0,0,0,0.08)",
    backdropFilter: "blur(6px)",
  },

  cardTitle: {
    fontWeight: 900,
    letterSpacing: "0.06em",
    fontSize: 13,
    opacity: 0.75,
    marginBottom: 10,
  },

  row: {
    display: "grid",
    gridTemplateColumns: "140px 1fr",
    gap: 10,
    marginBottom: 8,
  },
  label: { opacity: 0.6, fontWeight: 700 },
  value: { fontWeight: 800, color: "#1C2B39" },

  sep: {
    height: 1,
    background: "rgba(0,0,0,0.10)",
    margin: "12px 0",
  },

  barsWrap: {
    marginTop: 6,
  },

  barTop: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  barLabel: { fontWeight: 800, color: "#1C2B39" },
  barValue: { fontWeight: 800, opacity: 0.75 },

  barTrack: {
    height: 12,
    borderRadius: 999,
    background: "rgba(0,0,0,0.08)",
    overflow: "hidden",
    border: "2px solid rgba(0,0,0,0.10)",
  },
  barFill: {
    height: "100%",
    borderRadius: 999,
    background:
      "linear-gradient(90deg, rgba(124,255,203,0.9), rgba(125,182,255,0.9), rgba(255,133,214,0.85))",
  },

  dialWrap: {
    display: "grid",
    gridTemplateColumns: "160px 1fr",
    gap: 12,
    alignItems: "center",
  },

  dialCard: {
    borderRadius: 18,
    border: "2px solid rgba(0,0,0,0.12)",
    background: "rgba(255,255,255,0.78)",
    padding: 10,
    boxShadow: "0 10px 18px rgba(0,0,0,0.08)",
  },

  dialTextBig: {
    fontSize: 28,
    fontWeight: 900,
    fill: "#1C2B39",
  },
  dialTextSmall: {
    fontSize: 12,
    fontWeight: 800,
    fill: "rgba(28,43,57,0.65)",
  },

  dialFooter: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 6px 0",
  },
  dialEmoji: { fontSize: 22 },
  dialHint: { fontSize: 12, fontWeight: 800, opacity: 0.7 },

  dialMeta: {
    lineHeight: 1.45,
  },
  bigLine: {
    fontSize: 16,
    fontWeight: 800,
    color: "#1C2B39",
    marginBottom: 6,
  },

  hints: {
    display: "grid",
    gap: 6,
    fontSize: 13,
    lineHeight: 1.35,
  },
  hintLine: {
    padding: "8px 10px",
    borderRadius: 14,
    border: "2px solid rgba(0,0,0,0.10)",
    background: "rgba(255,255,255,0.65)",
    fontWeight: 700,
    opacity: 0.88,
  },

  controls: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  },

  btn: {
    base: {
      borderRadius: 999,
      padding: "12px 14px",
      fontSize: 14,
      fontWeight: 900,
      border: "2px solid rgba(0,0,0,0.14)",
      cursor: "pointer",
      boxShadow: "0 10px 18px rgba(0,0,0,0.10)",
      transition: "transform 120ms ease",
    },
    primary: {
      background:
        "linear-gradient(90deg, rgba(124,255,203,0.95), rgba(125,182,255,0.95), rgba(255,133,214,0.90))",
      color: "#13202B",
    },
    ghost: {
      background: "rgba(255,255,255,0.85)",
      color: "#13202B",
    },
    danger: {
      background: "rgba(0,0,0,0.88)",
      color: "white",
    },
    disabled: {
      opacity: 0.5,
      cursor: "not-allowed",
      boxShadow: "none",
    },
  },

  glitch: {
    noiseLayer: {
      position: "fixed",
      inset: 0,
      pointerEvents: "none",
      opacity: 0.16,
      mixBlendMode: "multiply",
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.45'/%3E%3C/svg%3E\")",
      backgroundRepeat: "repeat",
      animation: "sxNoise 0.9s steps(2) infinite",
      zIndex: 1,
    },
    scanlines: {
      position: "fixed",
      inset: 0,
      pointerEvents: "none",
      opacity: 0.14,
      backgroundImage:
        "linear-gradient(to bottom, rgba(0,0,0,0.18) 1px, rgba(0,0,0,0) 2px)",
      backgroundSize: "100% 6px",
      mixBlendMode: "multiply",
      animation: "sxScan 2.5s linear infinite",
      zIndex: 2,
    },
  },
};

// Keyframes injection (kept from your version)
if (typeof document !== "undefined" && !document.getElementById("sx-keyframes")) {
  const style = document.createElement("style");
  style.id = "sx-keyframes";
  style.textContent = `
    @keyframes sxNoise {
      0% { transform: translate3d(0,0,0); }
      25% { transform: translate3d(-2%, 1%, 0); }
      50% { transform: translate3d(1%, -1%, 0); }
      75% { transform: translate3d(2%, 2%, 0); }
      100% { transform: translate3d(0,0,0); }
    }
    @keyframes sxScan {
      0% { transform: translateY(0); }
      100% { transform: translateY(6px); }
    }
    button:active { transform: translateY(1px) scale(0.99); }
  `;
  document.head.appendChild(style);
}
