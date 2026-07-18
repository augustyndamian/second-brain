import { useAreas } from "../areas-context";

/** "today", "tracker" and "graph" are reserved; any other value is an area id. */
export type Screen = string;

export function Sidebar({
  screen,
  onSelect,
}: {
  screen: Screen;
  onSelect: (s: Screen) => void;
}) {
  const { areas } = useAreas();

  return (
    <aside className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col">
      <div className="px-4 py-3 border-b border-slate-800">
        <div className="font-bold text-base">Second Brain</div>
        <div className="text-xs text-slate-500">local kanban</div>
      </div>
      <nav className="flex-1 py-2">
        <NavItem active={screen === "today"} onClick={() => onSelect("today")}>
          <span>📅</span>
          <span>Today</span>
        </NavItem>
        <NavItem active={screen === "tracker"} onClick={() => onSelect("tracker")}>
          <span>🎯</span>
          <span>Tracker</span>
        </NavItem>
        <NavItem active={screen === "graph"} onClick={() => onSelect("graph")}>
          <span>🕸️</span>
          <span>Graph</span>
        </NavItem>
        <div className="mx-4 my-2 border-t border-slate-800" />
        {areas.map((a) => (
          <NavItem key={a.id} active={screen === a.id} onClick={() => onSelect(a.id)}>
            {/* Inline style, not a Tailwind class: area colors are user data, unknown at build time. */}
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: a.color }} />
            <span>{a.emoji}</span>
            <span>{a.label}</span>
          </NavItem>
        ))}
      </nav>
    </aside>
  );
}

function NavItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
        active
          ? "bg-slate-800 text-white border-l-2 border-blue-500"
          : "text-slate-400 hover:bg-slate-800 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
