import { useEffect, useMemo, useState } from "react";
import { db } from "./firebase";
import { onValue, push, ref } from "firebase/database";

const COOLDOWN_MS = 2000;

function getOrCreateDeviceId() {
  const key = "sx_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id =
      crypto?.randomUUID?.() ||
      `sx_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function hashToInt(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function roleFromDeviceId(deviceId) {
  const r = hashToInt(deviceId) % 3;
  if (r === 0) return "Observer";
  if (r === 1) return "Glitch";
  return "Hacker";
}

export default function Audience() {
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const role = useMemo(() => roleFromDeviceId(deviceId), [deviceId]);

  const [session, setSession] = useState({
    state: "waiting",
    roundId: 0,
    endsAt: 0,
    nextStartsAt: 0,
  });

  const [director, setDirector] = useState({ mode: "normal", autoRun: false });
  const [world, setWorld] = useState({ stability: 70, dominant: "stable" });

  const [now, setNow] = useState(Date.now());
  const [last, setLast] = useState("");

  const [lastActionTs, setLastActionTs] = useState(() => {
    const v = Number(localStorage.getItem("sx_last_action_ts") || "0");
    return Number.isFinite(v) ? v : 0;
  });

  const [normalUsedRound, setNormalUsedRound] = useState(() =>
    Number(localStorage.getItem("sx_normal_used_round") || "0")
  );
  const [abilityUsedRound, setAbilityUsedRound] = useState(() =>
    Number(localStorage.getItem("sx_ability_used_round") || "0")
  );

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const sessionRef = ref(db, "session");
    return onValue(sessionRef, (snap) => {
      const s = snap.val() || {
        state: "waiting",
        roundId: 0,
        endsAt: 0,
        nextStartsAt: 0,
      };
      setSession(s);
    });
  }, []);

  useEffect(() => {
    const dRef = ref(db, "director");
    return onValue(dRef, (snap) => {
      const d = snap.val();
      if (d) setDirector({ mode: d.mode || "normal", autoRun: !!d.autoRun });
      else setDirector({ mode: "normal", autoRun: false });
    });
  }, []);

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

  const secondsLeft = Math.max(0, Math.ceil(((session.endsAt || 0) - now) / 1000));
  const startsIn = Math.max(0, Math.ceil(((session.nextStartsAt || 0) - now) / 1000));

  const cooldownLeft = Math.max(0, Math.ceil((COOLDOWN_MS - (now - lastActionTs)) / 1000));

  const modeBlocksInput = director.mode !== "normal" || session.state === "frozen";
  const isActive =
    !modeBlocksInput &&
    session?.state === "active" &&
    session?.roundId > 0 &&
    secondsLeft > 0;

  const normalAvailable = isActive && normalUsedRound !== session.roundId && cooldownLeft === 0;
  const abilityAvailable = isActive && abilityUsedRound !== session.roundId && cooldownLeft === 0;

  const sendVote = async ({ type, power, kind }) => {
    if (!isActive) return;
    if (cooldownLeft !== 0) return;
    if (kind === "normal" && normalUsedRound === session.roundId) return;
    if (kind === "ability" && abilityUsedRound === session.roundId) return;

    await push(ref(db, `votes/${session.roundId}`), {
      type,
      power,
      kind,
      role,
      deviceId,
      ts: Date.now(),
    });

    const ts = Date.now();
    setLastActionTs(ts);
    localStorage.setItem("sx_last_action_ts", String(ts));

    if (kind === "normal") {
      setNormalUsedRound(session.roundId);
      localStorage.setItem("sx_normal_used_round", String(session.roundId));
    } else {
      setAbilityUsedRound(session.roundId);
      localStorage.setItem("sx_ability_used_round", String(session.roundId));
    }

    setLast(`${type} (${kind})`);
  };

  const voteNormal = (type) => sendVote({ type, power: 1, kind: "normal" });

  const useAbility = () => {
    if (role === "Observer") return sendVote({ type: "stable", power: 3, kind: "ability" });
    if (role === "Glitch") return sendVote({ type: "glitch", power: 3, kind: "ability" });
    return sendVote({ type: "override", power: 3, kind: "ability" });
  };

  const abilityLabel =
    role === "Observer"
      ? "Stabilize (x3)"
      : role === "Glitch"
      ? "Inject Glitch (x3)"
      : "Override Pulse (x3)";

  const blackoutMode = director.mode === "blackout";

  return (
    <div style={au.page}>
      {/* ✅ Blackout only here */}
      {blackoutMode && <div style={au.blackout} />}

      <div style={au.shell}>
        <div style={au.kicker}>SIMULATION X</div>
        <h1 style={au.h1}>Choose the world.</h1>

        <div style={au.card}>
          <div style={au.metaLine}>
            <b>Role:</b> {role} <span style={au.mini}>({deviceId.slice(0, 6)}…)</span>
          </div>
          <div style={au.metaLine}>
            <b>Mode:</b> {director.mode.toUpperCase()} • <b>Round:</b> {session.roundId || "-"}
          </div>
          <div style={au.metaLine}>
            <b>Status:</b> {session.state?.toUpperCase() || "WAITING"}
            {session.state === "active" ? ` • ${secondsLeft}s` : ""}
            {session.state === "waiting" && director.autoRun && director.mode === "normal" && session.nextStartsAt
              ? ` • next in ${startsIn}s`
              : ""}
          </div>

          <div style={au.sep} />

          <div style={au.metaLine}>
            <b>Stability:</b> {world.stability}/100 • <b>Dominant:</b> {(world.dominant || "stable").toUpperCase()}
          </div>

          <div style={au.barTrack}>
            <div style={{ ...au.barFill, width: `${world.stability}%` }} />
          </div>
        </div>

        <div style={au.btnGrid}>
          <button style={{ ...au.btn, ...(normalAvailable ? {} : au.btnDisabled) }} disabled={!normalAvailable} onClick={() => voteNormal("stable")}>
            Stable (x1)
          </button>
          <button style={{ ...au.btn, ...(normalAvailable ? {} : au.btnDisabled) }} disabled={!normalAvailable} onClick={() => voteNormal("glitch")}>
            Glitch (x1)
          </button>
          <button style={{ ...au.btn, ...(normalAvailable ? {} : au.btnDisabled) }} disabled={!normalAvailable} onClick={() => voteNormal("override")}>
            Override (x1)
          </button>

          <button style={{ ...au.btnWide, ...(abilityAvailable ? {} : au.btnDisabled) }} disabled={!abilityAvailable} onClick={useAbility}>
            {abilityLabel}
          </button>
        </div>

        <div style={au.footer}>
          {blackoutMode && <div>Blackout. Please wait…</div>}
          {!blackoutMode && director.mode === "freeze" && <div>System frozen. Please wait…</div>}
          {!isActive && !modeBlocksInput && <div>Voting is closed. Wait for the next round.</div>}
          {isActive && cooldownLeft > 0 && <div>Cooldown: {cooldownLeft}s</div>}
          {last && <div>Last: <b>{last}</b></div>}
        </div>
      </div>
    </div>
  );
}

const au = {
  page: {
    minHeight: "100vh",
    padding: 18,
    fontFamily: "system-ui",
    background:
      "radial-gradient(circle at 20% 10%, rgba(255,214,94,0.55), transparent 45%), radial-gradient(circle at 80% 20%, rgba(124,255,203,0.45), transparent 50%), radial-gradient(circle at 20% 90%, rgba(125,182,255,0.45), transparent 55%), radial-gradient(circle at 90% 90%, rgba(255,133,214,0.38), transparent 55%), #F7FFEC",
  },
  shell: { maxWidth: 520, margin: "0 auto" },
  kicker: { letterSpacing: "0.22em", fontSize: 12, opacity: 0.7, fontWeight: 900 },
  h1: { margin: "8px 0 14px", fontSize: 46, lineHeight: 1.05, color: "#1C2B39" },
  card: {
    background: "rgba(255,255,255,0.75)",
    border: "2px solid rgba(0,0,0,0.12)",
    borderRadius: 18,
    padding: 14,
    boxShadow: "0 10px 24px rgba(0,0,0,0.08)",
    backdropFilter: "blur(6px)",
    marginBottom: 14,
  },
  metaLine: { fontSize: 14, lineHeight: 1.6, opacity: 0.9 },
  mini: { fontSize: 12, opacity: 0.65 },
  sep: { height: 1, background: "rgba(0,0,0,0.10)", margin: "10px 0" },
  barTrack: {
    height: 12,
    borderRadius: 999,
    background: "rgba(0,0,0,0.08)",
    overflow: "hidden",
    border: "2px solid rgba(0,0,0,0.10)",
    marginTop: 8,
  },
  barFill: {
    height: "100%",
    borderRadius: 999,
    background:
      "linear-gradient(90deg, rgba(124,255,203,0.9), rgba(125,182,255,0.9), rgba(255,133,214,0.85))",
  },
  btnGrid: { display: "grid", gap: 12 },
  btn: {
    borderRadius: 18,
    padding: "14px 14px",
    fontSize: 16,
    fontWeight: 900,
    border: "2px solid rgba(0,0,0,0.14)",
    background: "rgba(255,255,255,0.85)",
    boxShadow: "0 10px 18px rgba(0,0,0,0.10)",
    cursor: "pointer",
  },
  btnWide: {
    borderRadius: 18,
    padding: "14px 14px",
    fontSize: 16,
    fontWeight: 900,
    border: "2px solid rgba(0,0,0,0.14)",
    background:
      "linear-gradient(90deg, rgba(124,255,203,0.95), rgba(125,182,255,0.95), rgba(255,133,214,0.90))",
    boxShadow: "0 10px 18px rgba(0,0,0,0.10)",
    cursor: "pointer",
  },
  btnDisabled: { opacity: 0.5, cursor: "not-allowed", boxShadow: "none" },
  footer: { marginTop: 12, opacity: 0.8, lineHeight: 1.45 },
  blackout: {
    position: "fixed",
    inset: 0,
    background: "#000",
    opacity: 0.92,
    zIndex: 999,
    pointerEvents: "none",
  },
};
