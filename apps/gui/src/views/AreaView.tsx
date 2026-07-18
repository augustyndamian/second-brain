import { useEffect, useState } from "react";
import type { Area, Board, RecurringRule } from "@second-brain/core";
import { BoardKanban } from "./BoardKanban";
import { RecurringList } from "./RecurringList";

export function AreaView({ area, tab }: { area: Area; tab: "boards" | "recurring" }) {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [rules, setRules] = useState<RecurringRule[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (tab === "boards") {
      window.api.boards.list(area).then((bs) => {
        if (cancelled) return;
        setBoards(bs);
        const def = bs.find((b) => b.isDefault) ?? bs[0];
        setActiveBoardId(def?.id ?? null);
      });
    } else {
      window.api.recurring.list(area).then((rs) => {
        if (!cancelled) setRules(rs);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [area, tab]);

  if (tab === "boards") {
    if (!boards) return <Loading />;
    if (boards.length === 0) return <Empty>No boards in this area.</Empty>;
    const active = boards.find((b) => b.id === activeBoardId) ?? boards[0]!;
    return (
      <div className="p-6 flex flex-col gap-4 h-full">
        {boards.length > 1 && (
          <div className="flex gap-2">
            {boards.map((b) => (
              <button
                key={b.id}
                onClick={() => setActiveBoardId(b.id)}
                className={`px-3 py-1 text-sm rounded ${
                  b.id === active.id
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {b.name}
                {b.isDefault ? " *" : ""}
              </button>
            ))}
          </div>
        )}
        <BoardKanban board={active} area={area} />
      </div>
    );
  }

  if (!rules) return <Loading />;
  return <RecurringList area={area} rules={rules} />;
}

function Loading() {
  return <div className="p-6 text-slate-500 text-sm">Loading…</div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-slate-500 text-sm">{children}</div>;
}
