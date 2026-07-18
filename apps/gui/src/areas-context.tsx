import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AreaConfig } from "@second-brain/core";

/** Shown for areas that exist in data but not in areas.yaml (e.g. removed after the fact). */
const UNKNOWN_AREA: Omit<AreaConfig, "id"> = { label: "", emoji: "❓", color: "#64748b" };

interface AreasValue {
  areas: AreaConfig[];
  /** Never throws — unknown ids get a neutral grey placeholder. */
  byId: (id: string) => AreaConfig;
  loaded: boolean;
}

const AreasContext = createContext<AreasValue>({
  areas: [],
  byId: (id) => ({ ...UNKNOWN_AREA, id, label: id }),
  loaded: false,
});

export function AreasProvider({ children }: { children: React.ReactNode }) {
  const [areas, setAreas] = useState<AreaConfig[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const list = await window.api.areas.list();
    setAreas(list);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
    // areas.yaml is edited out-of-band (kb area add / the /onboard command) — refetch on change.
    return window.api.onStorageChanged((info) => {
      if (!info?.filePath || info.filePath.endsWith("areas.yaml")) void load();
    });
  }, [load]);

  const value = useMemo<AreasValue>(() => {
    const map = new Map(areas.map((a) => [a.id, a]));
    return {
      areas,
      byId: (id) => map.get(id) ?? { ...UNKNOWN_AREA, id, label: id },
      loaded,
    };
  }, [areas, loaded]);

  return <AreasContext.Provider value={value}>{children}</AreasContext.Provider>;
}

export function useAreas(): AreasValue {
  return useContext(AreasContext);
}
