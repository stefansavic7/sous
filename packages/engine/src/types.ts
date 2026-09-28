/** Something a step occupies while it runs. Hands are tracked separately via `kind`. */
export type Resource =
  | { type: "oven"; tempC: number }
  | { type: "burner" }
  | { type: "none" };

export type StepKind = "active" | "passive";

export interface RecipeStep {
  /** Optional stable id; the planner generates one when absent. */
  id?: string;
  /** Imperative, voice-friendly label: "Put the salmon in the oven". */
  label: string;
  /** Duration in whole minutes (>= 1). */
  minutes: number;
  /** Active steps need the cook's hands; passive steps (baking, simmering, resting) do not. */
  kind: StepKind;
  resource?: Resource;
  /**
   * True when the food may sit between this step ending and the next step starting
   * (chopped vegetables can wait; seared steak cannot skip its rest). Defaults to false.
   */
  canWaitAfter?: boolean;
  /** Baking needs its exact temperature, so the planner never shifts it to share an oven. */
  exactTemp?: boolean;
}

export interface Recipe {
  id: string;
  name: string;
  /** Minutes the finished dish can wait before quality drops (salad 30, salmon 3). */
  holdMinutes: number;
  steps: RecipeStep[];
  tags?: string[];
  ingredients?: string[];
  serves?: number;
  source?: "library" | "user";
}

export interface Kitchen {
  ovens: number;
  /** Dishes that fit in one oven at the same time. */
  racksPerOven: number;
  burners: number;
  /** People cooking. Each active step needs one. */
  cooks: number;
  preheatMinutes: number;
  /** Oven dishes can share an oven when their temperatures differ by at most this much. */
  ovenToleranceC: number;
}

export const DEFAULT_KITCHEN: Kitchen = {
  ovens: 1,
  racksPerOven: 2,
  burners: 4,
  cooks: 1,
  preheatMinutes: 12,
  ovenToleranceC: 15,
};

export type StepStatus = "pending" | "done";

export interface PlannedStep {
  id: string;
  dishId: string;
  dishName: string;
  label: string;
  kind: StepKind;
  resource: Resource;
  /** Oven index when resource is an oven (0-based). */
  oven?: number;
  /** Minutes relative to serve time (negative = before serving). */
  start: number;
  end: number;
  status: StepStatus;
  /** Auto-inserted by the planner (preheat, rewarm), not part of a recipe. */
  system?: boolean;
}

export interface PlannedDish {
  id: string;
  name: string;
  /** Minute (relative to serve time) the dish is finished. */
  readyAt: number;
  holdMinutes: number;
  /** Minutes the dish waits after it's done. */
  waits: number;
}

export interface Plan {
  id: string;
  /** Epoch milliseconds of the serve time. */
  serveAt: number;
  createdAt: number;
  /** Temperature units used in labels. */
  units: "C" | "F";
  kitchen: Kitchen;
  dishes: PlannedDish[];
  steps: PlannedStep[];
  warnings: string[];
  /** Minutes of hands-on work in the plan. */
  activeMinutes: number;
  /** Minutes from first step to serving. */
  totalMinutes: number;
}

export interface NowView {
  /** Steps that should be running right now. */
  current: Array<PlannedStep & { remaining: number }>;
  /** Pending steps that start in the future, soonest first. */
  upcoming: Array<PlannedStep & { startsIn: number }>;
  /** Active steps whose start time already passed but are not marked done. */
  overdue: PlannedStep[];
  minutesToServe: number;
  finished: boolean;
}
