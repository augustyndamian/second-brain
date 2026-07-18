import { useEffect, useRef, useState } from "react";
import type { FocusSession } from "@second-brain/core";
import { useAreas } from "../areas-context";

function elapsedMs(session: FocusSession, now: number): number {
  const start = Date.parse(session.startedAt);
  const pausedNow = session.pausedAt ? now - Date.parse(session.pausedAt) : 0;
  return now - start - session.accumulatedPausedMs - pausedNow;
}

function formatRemaining(remainingMs: number): { text: string; overflow: boolean } {
  const overflow = remainingMs < 0;
  const total = Math.floor(Math.abs(remainingMs) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return { text: `${overflow ? "+" : ""}${mm}:${ss}`, overflow };
}

export function FocusPanel({
  session,
  onDone,
  onStop,
  onPauseToggle,
}: {
  session: FocusSession | null;
  onDone: () => void;
  onStop: () => void;
  onPauseToggle: () => void;
}) {
  const [tick, setTick] = useState(0);
  const alertedRef = useRef<string | null>(null);
  const { byId } = useAreas();

  useEffect(() => {
    if (!session) return;
    if (session.pausedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [session?.startedAt, session?.pausedAt]);

  useEffect(() => {
    if (!session) return;
    const totalMs = session.durationMin * 60_000;
    const remaining = totalMs - elapsedMs(session, Date.now());
    const key = session.startedAt;
    if (remaining <= 0 && alertedRef.current !== key) {
      alertedRef.current = key;
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("Focus time up", { body: session.title });
        } else if (typeof Notification !== "undefined" && Notification.permission !== "denied") {
          Notification.requestPermission().then((p) => {
            if (p === "granted") new Notification("Focus time up", { body: session.title });
          });
        }
      } catch { /* ignore */ }
      try {
        const audio = new Audio("sounds/glass.wav");
        audio.play().catch(() => {});
      } catch { /* ignore */ }
    }
  }, [tick, session?.startedAt]);

  if (!session) {
    return (
      <div className="flex items-center h-full text-xs text-slate-600 italic">
        No active focus. Click ▶ on a task to start.
      </div>
    );
  }

  const totalMs = session.durationMin * 60_000;
  const remaining = totalMs - elapsedMs(session, Date.now());
  const { text, overflow } = formatRemaining(remaining);
  const paused = !!session.pausedAt;

  return (
    <div className="flex items-center gap-4 h-full">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full text-white/80"
            style={{ backgroundColor: byId(session.area).color }}
          >
            {session.area}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-emerald-400">● Focus</span>
        </div>
        <div className="text-base font-semibold text-slate-100 truncate" title={session.title}>
          {session.title}
        </div>
        {session.description && (
          <div className="text-xs text-slate-400 truncate" title={session.description}>
            {session.description}
          </div>
        )}
      </div>
      <div className="flex flex-col items-center">
        <div className={`text-2xl font-mono ${overflow ? "text-amber-400" : paused ? "text-slate-400" : "text-slate-100"}`}>
          {text}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500">
          {paused ? "paused" : `${session.durationMin}m pomodoro`}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onPauseToggle}
          title={paused ? "Resume (P)" : "Pause (P)"}
          className="w-8 h-8 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 flex items-center justify-center"
        >
          {paused ? "▶" : "⏸"}
        </button>
        <button
          onClick={onDone}
          title="Done (Space)"
          className="px-3 h-8 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-sm flex items-center gap-1"
        >
          ✓ Done
        </button>
        <button
          onClick={onStop}
          title="Stop focus (Esc)"
          className="w-8 h-8 rounded bg-slate-800 hover:bg-red-900 border border-slate-700 text-slate-400 hover:text-red-300 flex items-center justify-center"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
