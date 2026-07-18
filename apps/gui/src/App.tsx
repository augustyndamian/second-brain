import { useEffect, useState } from "react";
import type { Area } from "@second-brain/core";
import { Sidebar, type Screen } from "./components/Sidebar";
import { useAreas } from "./areas-context";
import { AreaView } from "./views/AreaView";
import { TodayView } from "./views/TodayView";
import { TrackerView } from "./views/TrackerView";

type Tab = "boards" | "recurring";

export function App() {
  const [screen, setScreen] = useState<Screen>("today");
  const [tab, setTab] = useState<Tab>("boards");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    window.api.init();
    const off = window.api.onStorageChanged((info) => {
      // Daily-notes file changes are owned by the Notes tab itself (NotesPanel reloads
      // via notes.read after its own writes). Bumping reloadKey here causes a full
      // TodayView remount, resetting subTab back to "tasks" — surprising the user
      // mid-Notes-edit. Skip this file class globally.
      if (info?.filePath && info.filePath.includes("/daily-notes/")) return;
      setReloadKey((k) => k + 1);
    });
    return off;
  }, []);

  const { areas, byId, loaded } = useAreas();
  const isArea = areas.some((a) => a.id === screen);

  // An area can disappear (kb area remove) while its screen is open — fall back to Today.
  useEffect(() => {
    if (!loaded || screen === "today" || screen === "tracker") return;
    if (!areas.some((a) => a.id === screen)) setScreen("today");
  }, [areas, loaded, screen]);

  const areaLabel = isArea ? byId(screen).label : null;

  return (
    <div className="flex h-full">
      <Sidebar screen={screen} onSelect={setScreen} />
      <main className="flex-1 flex flex-col overflow-hidden">
        {screen === "today" && (
          <TodayView reloadKey={reloadKey} />
        )}

        {screen === "tracker" && <TrackerView key={`tracker-${reloadKey}`} />}

        {isArea && (
          <>
            <header className="flex items-center justify-between px-6 py-3 border-b border-slate-700">
              <h1 className="text-lg font-semibold">{areaLabel}</h1>
              <nav className="flex gap-2">
                <TabButton active={tab === "boards"} onClick={() => setTab("boards")}>Boards</TabButton>
                <TabButton active={tab === "recurring"} onClick={() => setTab("recurring")}>Recurring</TabButton>
              </nav>
            </header>
            <div className="flex-1 overflow-auto">
              <AreaView key={`${screen}-${tab}-${reloadKey}`} area={screen as Area} tab={tab} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function TabButton({
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
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? "bg-slate-700 text-white"
          : "text-slate-400 hover:text-white hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}
