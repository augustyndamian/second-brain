import { contextBridge, ipcRenderer } from "electron";

const api = {
  init: () => ipcRenderer.invoke("init"),

  areas: {
    list: () => ipcRenderer.invoke("areas:list"),
  },

  boards: {
    list: (area?: string) => ipcRenderer.invoke("board:list", area),
    create: (input: any) => ipcRenderer.invoke("board:create", input),
  },

  tasks: {
    list: (filter?: any) => ipcRenderer.invoke("task:list", filter),
    show: (id: string) => ipcRenderer.invoke("task:show", id),
    create: (input: any) => ipcRenderer.invoke("task:create", input),
    edit: (id: string, input: any) => ipcRenderer.invoke("task:edit", id, input),
    move: (id: string, to: string) => ipcRenderer.invoke("task:move", id, to),
    reschedule: (id: string, toDate: string, reason?: string | null) =>
      ipcRenderer.invoke("task:reschedule", id, toDate, reason),
    delete: (id: string) => ipcRenderer.invoke("task:delete", id),
  },

  recurring: {
    list: (area?: string) => ipcRenderer.invoke("recurring:list", area),
    create: (input: any) => ipcRenderer.invoke("recurring:create", input),
    delete: (id: string) => ipcRenderer.invoke("recurring:delete", id),
    toggle: (id: string) => ipcRenderer.invoke("recurring:toggle", id),
    done: (id: string, date?: string) => ipcRenderer.invoke("recurring:done", id, date),
    skip: (id: string, date?: string, reason?: string) =>
      ipcRenderer.invoke("recurring:skip", id, date, reason),
    reschedule: (id: string, from: string, to: string, reason?: string) =>
      ipcRenderer.invoke("recurring:reschedule", id, from, to, reason),
  },

  today: Object.assign(
    (date?: string) => ipcRenderer.invoke("today", date),
    {
      trigger: () => ipcRenderer.invoke("today:trigger"),
    },
  ),

  session: {
    active: () => ipcRenderer.invoke("session:active"),
    close: () => ipcRenderer.invoke("session:close"),
    ensure: () => ipcRenderer.invoke("session:ensure"),
  },

  day: {
    view: (date: string) => ipcRenderer.invoke("day:view", date),
  },

  notes: {
    read: (date: string, archive?: boolean) => ipcRenderer.invoke("notes:read", date, archive),
    append: (date: string, text: string) => ipcRenderer.invoke("notes:append", date, text),
    write: (date: string, content: string) => ipcRenderer.invoke("notes:write", date, content),
    autolog: (date: string, source: string, message: string) =>
      ipcRenderer.invoke("notes:autolog", date, source, message),
    archive: (date: string) => ipcRenderer.invoke("notes:archive", date),
    listArchive: () => ipcRenderer.invoke("notes:listArchive"),
  },

  focus: {
    get: () => ipcRenderer.invoke("focus:get"),
    set: (session: any) => ipcRenderer.invoke("focus:set", session),
    clear: () => ipcRenderer.invoke("focus:clear"),
  },

  tracking: {
    list: (filter?: any) => ipcRenderer.invoke("tracking:list", filter ?? {}),
    create: (input: any) => ipcRenderer.invoke("tracking:create", input),
    edit: (id: string, input: any) => ipcRenderer.invoke("tracking:edit", id, input),
    delete: (id: string) => ipcRenderer.invoke("tracking:delete", id),
  },

  openObsidian: (ref: string) => ipcRenderer.invoke("openObsidian", ref),
  openExternal: (url: string) => ipcRenderer.invoke("openExternal", url),

  onStorageChanged: (cb: (info: { eventType: string; filePath: string }) => void) => {
    const listener = (_e: any, info: any) => cb(info);
    ipcRenderer.on("storage:changed", listener);
    return () => ipcRenderer.removeListener("storage:changed", listener);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
