import { createMachine } from "xstate";

export const trainingMachine = createMachine({
  id: "training-session",
  initial: "idle",
  states: {
    idle: {
      on: { PREPARE: "scrambling" },
    },
    scrambling: {
      on: {
        SCRAMBLE_COMPLETE: "ready",
        RESET: "idle",
        DESYNC: "invalid",
      },
    },
    ready: {
      on: {
        FIRST_MOVE: "running",
        RESET: "idle",
        DESYNC: "invalid",
      },
    },
    running: {
      on: {
        SOLVED: "complete",
        RESET: "idle",
        DESYNC: "invalid",
      },
    },
    complete: {
      on: { PREPARE: "scrambling", RESET: "idle" },
    },
    invalid: {
      on: { RESYNC: "idle", RESET: "idle" },
    },
  },
});

export type TrainingMachineEvent =
  | { type: "PREPARE" }
  | { type: "SCRAMBLE_COMPLETE" }
  | { type: "FIRST_MOVE" }
  | { type: "SOLVED" }
  | { type: "DESYNC" }
  | { type: "RESYNC" }
  | { type: "RESET" };

