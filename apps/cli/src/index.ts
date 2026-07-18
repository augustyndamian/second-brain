#!/usr/bin/env bun
import { Command } from "commander";
import { taskCommand } from "./commands/task.js";
import { areaCommand } from "./commands/area.js";
import { boardCommand } from "./commands/board.js";
import { workspaceCommand } from "./commands/workspace.js";
import { recurringCommand } from "./commands/recurring.js";
import { sessionCommand } from "./commands/session.js";
import { dayViewCommand, overdueCommand, todayCommand } from "./commands/today.js";
import { trackingCommand } from "./commands/tracking.js";
import { notesCommand } from "./commands/notes.js";
import { eventsCommand } from "./commands/events.js";

const program = new Command();
program
  .name("kb")
  .description("Second Brain CLI — local kanban + knowledge base for Claude Code")
  .version("0.0.2");

program.addCommand(taskCommand());
program.addCommand(areaCommand());
program.addCommand(boardCommand());
program.addCommand(workspaceCommand());
program.addCommand(recurringCommand());
program.addCommand(sessionCommand());
program.addCommand(todayCommand());
program.addCommand(overdueCommand());
program.addCommand(dayViewCommand());
program.addCommand(trackingCommand());
program.addCommand(notesCommand());
program.addCommand(eventsCommand());

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
