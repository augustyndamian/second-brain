// Electron launched from Dock/Finder may not inherit TZ from shell.
// Force timezone before any Date operations to keep `localToday()` consistent
// with the user's actual local day across CLI and GUI.
if (!process.env.TZ) {
  try {
    const sysTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (sysTz) process.env.TZ = sysTz;
    else process.env.TZ = "UTC";
  } catch {
    process.env.TZ = "UTC";
  }
}

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  createBoard,
  createRule,
  createTask,
  defaultRoot,
  deleteRule,
  deleteTask,
  editTask,
  ensureStorageReady,
  listAllRules,
  listBoards,
  listTasks,
  markRuleDone,
  markRuleSkipped,
  moveTask,
  paths,
  rescheduleTask,
  readFocus,
  rescheduleRule,
  showTask,
  toggleRule,
  today,
  triggerToday,
  writeFocus,
  clearFocus,
  closeSession,
  ensureSession,
  readActive,
  dayView,
  createTrackingItem,
  editTrackingItem,
  deleteTrackingItem,
  listTracking,
  appendDailyNote,
  appendAutoLog,
  archiveDailyNote,
  listArchivedNotes,
  readArchivedDailyNote,
  readDailyNote,
  writeDailyNote,
  listAreas,
} from "@second-brain/core";
import { startGraphWatcher, startWatcher } from "./watcher";

// Resolution can fail (no workspace anywhere) — surface it as a dialog once the app
// is ready rather than crashing before a window ever appears.
let ROOT = "";
let mainWindow: BrowserWindow | null = null;

async function ensureInit() {
  await ensureStorageReady(ROOT);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "Second Brain",
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc() {
  ipcMain.handle("init", async () => {
    await ensureInit();
    return { root: ROOT };
  });

  ipcMain.handle("board:list", async (_e, area?: any) => listBoards(ROOT, area));
  ipcMain.handle("board:create", async (_e, input: any) => createBoard(ROOT, input));

  ipcMain.handle("task:list", async (_e, filter: any = {}) => listTasks(ROOT, filter));
  ipcMain.handle("task:show", async (_e, id: string) => showTask(ROOT, id));
  ipcMain.handle("task:create", async (_e, input: any) => createTask(ROOT, input));
  ipcMain.handle("task:edit", async (_e, id: string, input: any) => editTask(ROOT, id, input));
  ipcMain.handle("task:move", async (_e, id: string, to: any) => moveTask(ROOT, id, to));
  ipcMain.handle("task:reschedule", async (_e, id: string, toDate: string, reason?: string | null) =>
    rescheduleTask(ROOT, id, toDate, reason ?? null),
  );
  ipcMain.handle("task:delete", async (_e, id: string) => deleteTask(ROOT, id));

  ipcMain.handle("recurring:list", async (_e, area?: any) => listAllRules(ROOT, area));
  ipcMain.handle("recurring:create", async (_e, input: any) => createRule(ROOT, input));
  ipcMain.handle("recurring:delete", async (_e, id: string) => deleteRule(ROOT, id));
  ipcMain.handle("recurring:toggle", async (_e, id: string) => toggleRule(ROOT, id));
  ipcMain.handle("recurring:done", async (_e, id: string, _date?: string) => {
    const active = await readActive(ROOT);
    if (!active || active.status !== "open") throw new Error("no active session");
    return markRuleDone(ROOT, id, active.date);
  });
  ipcMain.handle("recurring:skip", async (_e, id: string, _date?: string, reason?: string) => {
    const active = await readActive(ROOT);
    if (!active || active.status !== "open") throw new Error("no active session");
    return markRuleSkipped(ROOT, id, active.date, reason ?? null);
  });
  ipcMain.handle("recurring:reschedule", async (_e, id: string, from: string, to: string, reason?: string) =>
    rescheduleRule(ROOT, id, from, to, reason ?? null),
  );

  ipcMain.handle("today", async (_e, date?: string) => today(ROOT, date));
  ipcMain.handle("today:trigger", async () => triggerToday(ROOT));

  ipcMain.handle("session:active", async () => readActive(ROOT));
  ipcMain.handle("session:close", async () => closeSession(ROOT));
  ipcMain.handle("session:ensure", async () => ensureSession(ROOT));
  ipcMain.handle("day:view", async (_e, date: string) => dayView(ROOT, date));

  ipcMain.handle("notes:read", async (_e, date: string, archive?: boolean) =>
    archive ? readArchivedDailyNote(ROOT, date) : readDailyNote(ROOT, date),
  );
  ipcMain.handle("notes:append", async (_e, date: string, text: string) => appendDailyNote(ROOT, date, text));
  ipcMain.handle("notes:write", async (_e, date: string, content: string) => writeDailyNote(ROOT, date, content));
  ipcMain.handle("notes:autolog", async (_e, date: string, source: string, message: string) =>
    appendAutoLog(ROOT, date, source, message),
  );
  ipcMain.handle("notes:archive", async (_e, date: string) => archiveDailyNote(ROOT, date));
  ipcMain.handle("notes:listArchive", async () => listArchivedNotes(ROOT));

  ipcMain.handle("tracking:list", async (_e, filter: any = {}) => listTracking(ROOT, filter));
  ipcMain.handle("tracking:create", async (_e, input: any) => createTrackingItem(ROOT, input));
  ipcMain.handle("tracking:edit", async (_e, id: string, input: any) => editTrackingItem(ROOT, id, input));
  ipcMain.handle("tracking:delete", async (_e, id: string) => deleteTrackingItem(ROOT, id));

  ipcMain.handle("focus:get", async () => readFocus(ROOT));
  ipcMain.handle("focus:set", async (_e, session: any) => writeFocus(ROOT, session));
  ipcMain.handle("focus:clear", async () => clearFocus(ROOT));

  ipcMain.handle("openExternal", async (_e, url: string) => {
    await shell.openExternal(url);
  });

  // The workspace directory is the Obsidian vault, so its basename is the vault name.
  ipcMain.handle("openObsidian", async (_e, ref: string, vault?: string) => {
    const vaultName = vault ?? path.basename(path.dirname(ROOT));
    const url = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(ref)}`;
    await shell.openExternal(url);
  });

  ipcMain.handle("areas:list", async () => listAreas(ROOT));

  // graph.html lives in the workspace dir (dirname of the .kanban root), written by /graphify.
  ipcMain.handle("graph:read", async (): Promise<{ html: string | null }> => {
    const file = path.join(path.dirname(ROOT), "graphify-out", "graph.html");
    try {
      return { html: await fs.readFile(file, "utf8") };
    } catch {
      return { html: null }; // missing or mid-rewrite — renderer keeps its last good copy
    }
  });
}

app.whenReady().then(async () => {
  try {
    ROOT = defaultRoot();
  } catch (err) {
    dialog.showErrorBox(
      "No workspace found",
      `${err instanceof Error ? err.message : String(err)}\n\n` +
        "Second Brain stores data in a .kanban/ directory inside your workspace.",
    );
    app.quit();
    return;
  }

  await ensureInit();
  await ensureSession(ROOT);
  registerIpc();
  createWindow();

  startWatcher(paths(ROOT).root, (eventType, filePath) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("storage:changed", { eventType, filePath });
    }
  });

  startGraphWatcher(path.dirname(ROOT), () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("graph:changed");
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
