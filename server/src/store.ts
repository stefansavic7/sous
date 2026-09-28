import { LIBRARY, type Kitchen, type Plan, type Recipe, type TempUnits } from "../../packages/engine/src/index.ts";

export interface Household {
  kitchen: Partial<Kitchen>;
  units: TempUnits;
  timeZone: string;
}

export interface SousData {
  version: 1;
  household: Household;
  recipes: Recipe[];
  plans: Plan[];
  currentPlanId?: string;
}

export interface Persistence {
  load(): SousData | undefined;
  save(data: SousData): void;
}

/** Household state: kitchen setup, recipes they taught Sous, and dinner plans. */
export class SousStore {
  private data: SousData;
  private readonly persistence?: Persistence;

  constructor(defaults: Partial<Household> = {}, persistence?: Persistence) {
    this.persistence = persistence;
    const loaded = persistence?.load();
    const tz = defaults.timeZone ?? "America/New_York";
    this.data = loaded ?? {
      version: 1,
      household: {
        kitchen: defaults.kitchen ?? {},
        units: defaults.units ?? (tz.startsWith("America/") ? "F" : "C"),
        timeZone: tz,
      },
      recipes: [],
      plans: [],
    };
  }

  private persist(): void {
    this.persistence?.save(this.data);
  }

  get household(): Household {
    return this.data.household;
  }

  updateHousehold(patch: Partial<Household> & { kitchen?: Partial<Kitchen> }): Household {
    const h = this.data.household;
    this.data.household = {
      ...h,
      ...patch,
      kitchen: { ...h.kitchen, ...(patch.kitchen ?? {}) },
    };
    this.persist();
    return this.data.household;
  }

  /** Built-in cookbook plus recipes the household added (theirs win on name clashes). */
  allRecipes(): Recipe[] {
    const mine = this.data.recipes;
    const names = new Set(mine.map((r) => r.name.toLowerCase()));
    return [...mine, ...LIBRARY.filter((r) => !names.has(r.name.toLowerCase()))];
  }

  addRecipe(recipe: Recipe): Recipe {
    this.data.recipes = [recipe, ...this.data.recipes.filter((r) => r.id !== recipe.id)];
    this.persist();
    return recipe;
  }

  getRecipe(id: string): Recipe | undefined {
    return this.allRecipes().find((r) => r.id === id);
  }

  savePlan(plan: Plan, makeCurrent = true): Plan {
    this.data.plans = [plan, ...this.data.plans.filter((p) => p.id !== plan.id)].slice(0, 20);
    if (makeCurrent) this.data.currentPlanId = plan.id;
    this.persist();
    return plan;
  }

  getPlan(id?: string): Plan | undefined {
    const wanted = id ?? this.data.currentPlanId;
    return this.data.plans.find((p) => p.id === wanted);
  }

  clearCurrent(): void {
    this.data.currentPlanId = undefined;
    this.persist();
  }
}
