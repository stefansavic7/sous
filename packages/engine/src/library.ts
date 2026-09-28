import type { Recipe } from "./types.ts";

const oven = (tempC: number) => ({ type: "oven" as const, tempC });
const burner = { type: "burner" as const };
const none = { type: "none" as const };

/** A small built-in cookbook with timings a home cook can trust. */
export const LIBRARY: Recipe[] = [
  {
    id: "lemon-garlic-salmon",
    name: "Lemon garlic salmon",
    holdMinutes: 4,
    serves: 4,
    tags: ["fish", "main", "oven"],
    ingredients: ["salmon", "lemon", "garlic", "olive oil"],
    steps: [
      { label: "Mix lemon, garlic and olive oil, then season the salmon", minutes: 5, kind: "active", resource: none, canWaitAfter: true },
      { label: "Put the salmon in the oven", minutes: 14, kind: "passive", resource: oven(200) },
      { label: "Let the salmon rest", minutes: 3, kind: "passive", resource: none },
    ],
  },
  {
    id: "white-rice",
    name: "Fluffy white rice",
    holdMinutes: 20,
    serves: 4,
    tags: ["side", "grain", "stovetop"],
    ingredients: ["rice", "water", "salt"],
    steps: [
      { label: "Rinse the rice until the water runs clear", minutes: 3, kind: "active", resource: none, canWaitAfter: true },
      { label: "Bring the rice and water to a boil", minutes: 6, kind: "passive", resource: burner },
      { label: "Cover the rice and simmer on low", minutes: 15, kind: "passive", resource: burner },
      { label: "Take the rice off the heat and let it steam, lid on", minutes: 10, kind: "passive", resource: none },
    ],
  },
  {
    id: "roasted-broccoli",
    name: "Roasted broccoli",
    holdMinutes: 8,
    serves: 4,
    tags: ["side", "vegetable", "oven"],
    ingredients: ["broccoli", "olive oil", "salt"],
    steps: [
      { label: "Cut the broccoli into florets and toss with oil and salt", minutes: 6, kind: "active", resource: none, canWaitAfter: true },
      { label: "Put the broccoli in the oven to roast", minutes: 20, kind: "passive", resource: oven(220) },
    ],
  },
  {
    id: "mashed-potatoes",
    name: "Garlic mashed potatoes",
    holdMinutes: 20,
    serves: 4,
    tags: ["side", "potato", "stovetop"],
    ingredients: ["potatoes", "butter", "garlic", "milk"],
    steps: [
      { label: "Peel and cube the potatoes", minutes: 8, kind: "active", resource: none, canWaitAfter: true },
      { label: "Boil the potatoes until tender", minutes: 18, kind: "passive", resource: burner },
      { label: "Drain and mash the potatoes with butter, garlic and milk", minutes: 5, kind: "active", resource: none },
    ],
  },
  {
    id: "seared-steak",
    name: "Pan-seared steak",
    holdMinutes: 3,
    serves: 2,
    tags: ["beef", "main", "stovetop"],
    ingredients: ["steak", "salt", "pepper", "butter"],
    steps: [
      { label: "Pat the steaks dry and season them well", minutes: 3, kind: "active", resource: none, canWaitAfter: true },
      { label: "Sear the steaks in a hot pan, flipping once", minutes: 8, kind: "active", resource: burner },
      { label: "Rest the steaks on a board", minutes: 8, kind: "passive", resource: none },
    ],
  },
  {
    id: "green-beans",
    name: "Green beans with almonds",
    holdMinutes: 5,
    serves: 4,
    tags: ["side", "vegetable", "stovetop"],
    ingredients: ["green beans", "almonds", "butter"],
    steps: [
      { label: "Trim the green beans", minutes: 5, kind: "active", resource: none, canWaitAfter: true },
      { label: "Bring a pot of salted water to a boil", minutes: 8, kind: "passive", resource: burner },
      { label: "Blanch the green beans", minutes: 4, kind: "passive", resource: burner },
      { label: "Sauté the beans with butter and almonds", minutes: 4, kind: "active", resource: burner },
    ],
  },
  {
    id: "spaghetti-aglio-olio",
    name: "Spaghetti aglio e olio",
    holdMinutes: 2,
    serves: 4,
    tags: ["pasta", "main", "stovetop", "vegetarian"],
    ingredients: ["spaghetti", "garlic", "olive oil", "chili", "parsley"],
    steps: [
      { label: "Bring a big pot of salted water to a boil", minutes: 10, kind: "passive", resource: burner },
      { label: "Cook the spaghetti", minutes: 9, kind: "passive", resource: burner },
      { label: "Toss the spaghetti with garlic oil, chili and parsley", minutes: 3, kind: "active", resource: burner },
    ],
  },
  {
    id: "garden-salad",
    name: "Garden salad",
    holdMinutes: 45,
    serves: 4,
    tags: ["side", "salad", "vegetarian", "no-cook"],
    ingredients: ["lettuce", "cucumber", "tomato", "red onion", "olive oil", "vinegar"],
    steps: [
      { label: "Wash and dry the greens", minutes: 5, kind: "active", resource: none, canWaitAfter: true },
      { label: "Slice the cucumber, tomatoes and onion", minutes: 6, kind: "active", resource: none, canWaitAfter: true },
      { label: "Whisk the vinaigrette", minutes: 3, kind: "active", resource: none, canWaitAfter: true },
      { label: "Dress and toss the salad", minutes: 2, kind: "active", resource: none },
    ],
  },
  {
    id: "roast-chicken-thighs",
    name: "Roast chicken thighs",
    holdMinutes: 10,
    serves: 4,
    tags: ["chicken", "main", "oven"],
    ingredients: ["chicken thighs", "paprika", "garlic", "salt"],
    steps: [
      { label: "Season the chicken thighs with paprika, garlic and salt", minutes: 5, kind: "active", resource: none, canWaitAfter: true },
      { label: "Put the chicken in the oven, skin side up", minutes: 35, kind: "passive", resource: oven(210) },
      { label: "Let the chicken rest", minutes: 5, kind: "passive", resource: none },
    ],
  },
  {
    id: "garlic-bread",
    name: "Garlic bread",
    holdMinutes: 5,
    serves: 4,
    tags: ["side", "bread", "oven"],
    ingredients: ["baguette", "butter", "garlic", "parsley"],
    steps: [
      { label: "Spread garlic butter on the bread", minutes: 4, kind: "active", resource: none, canWaitAfter: true },
      { label: "Put the garlic bread in the oven", minutes: 10, kind: "passive", resource: oven(190) },
    ],
  },
  {
    id: "tomato-soup",
    name: "Tomato soup",
    holdMinutes: 30,
    serves: 4,
    tags: ["soup", "starter", "stovetop", "vegetarian"],
    ingredients: ["tomatoes", "onion", "garlic", "stock"],
    steps: [
      { label: "Chop the onion and garlic", minutes: 5, kind: "active", resource: none, canWaitAfter: true },
      { label: "Soften the onion and garlic in olive oil", minutes: 6, kind: "active", resource: burner },
      { label: "Add the tomatoes and stock and let it simmer", minutes: 20, kind: "passive", resource: burner },
      { label: "Blend the soup until smooth", minutes: 3, kind: "active", resource: none },
    ],
  },
  {
    id: "brownies",
    name: "Chocolate brownies",
    holdMinutes: 120,
    serves: 8,
    tags: ["dessert", "oven", "baking"],
    ingredients: ["chocolate", "butter", "sugar", "eggs", "flour"],
    steps: [
      { label: "Melt butter and chocolate, then whisk in sugar, eggs and flour", minutes: 10, kind: "active", resource: burner, canWaitAfter: true },
      { label: "Put the brownies in the oven", minutes: 25, kind: "passive", resource: oven(180), exactTemp: true },
      { label: "Let the brownies cool before cutting", minutes: 30, kind: "passive", resource: none },
    ],
  },
  {
    id: "roast-potatoes",
    name: "Crispy roast potatoes",
    holdMinutes: 10,
    serves: 4,
    tags: ["side", "potato", "oven"],
    ingredients: ["potatoes", "olive oil", "rosemary", "salt"],
    steps: [
      { label: "Peel and chunk the potatoes", minutes: 8, kind: "active", resource: none, canWaitAfter: true },
      { label: "Parboil the potatoes", minutes: 8, kind: "passive", resource: burner },
      { label: "Drain the potatoes and rough up the edges", minutes: 2, kind: "active", resource: none },
      { label: "Put the potatoes in the oven to roast", minutes: 40, kind: "passive", resource: oven(220) },
    ],
  },
  {
    id: "couscous",
    name: "Herbed couscous",
    holdMinutes: 15,
    serves: 4,
    tags: ["side", "grain", "quick"],
    ingredients: ["couscous", "stock", "parsley", "lemon"],
    steps: [
      { label: "Bring the stock to a boil", minutes: 5, kind: "passive", resource: burner },
      { label: "Pour the stock over the couscous, cover and let it stand", minutes: 5, kind: "passive", resource: none },
      { label: "Fluff the couscous and stir in the herbs", minutes: 2, kind: "active", resource: none },
    ],
  },
  {
    id: "cevapi",
    name: "Ćevapi with onions",
    holdMinutes: 5,
    serves: 4,
    tags: ["beef", "main", "stovetop", "balkan"],
    ingredients: ["minced beef", "onion", "somun bread", "garlic"],
    steps: [
      { label: "Shape the ćevapi mixture into small fingers", minutes: 10, kind: "active", resource: none, canWaitAfter: true },
      { label: "Grill the ćevapi in a hot pan, turning often", minutes: 10, kind: "active", resource: burner },
      { label: "Slice the onion and warm the bread in the pan", minutes: 4, kind: "active", resource: burner },
    ],
  },
  {
    id: "glazed-carrots",
    name: "Honey glazed carrots",
    holdMinutes: 10,
    serves: 4,
    tags: ["side", "vegetable", "stovetop"],
    ingredients: ["carrots", "butter", "honey"],
    steps: [
      { label: "Peel and slice the carrots", minutes: 5, kind: "active", resource: none, canWaitAfter: true },
      { label: "Simmer the carrots with butter and honey until glazed", minutes: 15, kind: "passive", resource: burner },
    ],
  },
  {
    id: "apple-crumble",
    name: "Apple crumble",
    holdMinutes: 60,
    serves: 6,
    tags: ["dessert", "oven", "baking"],
    ingredients: ["apples", "flour", "butter", "sugar", "oats"],
    steps: [
      { label: "Slice the apples and rub together the crumble topping", minutes: 12, kind: "active", resource: none, canWaitAfter: true },
      { label: "Put the crumble in the oven", minutes: 35, kind: "passive", resource: oven(190), exactTemp: true },
      { label: "Let the crumble cool a little", minutes: 10, kind: "passive", resource: none },
    ],
  },
  {
    id: "roast-vegetables",
    name: "Roasted root vegetables",
    holdMinutes: 10,
    serves: 4,
    tags: ["side", "vegetable", "oven", "vegetarian"],
    ingredients: ["carrots", "parsnips", "red onion", "olive oil"],
    steps: [
      { label: "Chop the root vegetables and toss with oil", minutes: 8, kind: "active", resource: none, canWaitAfter: true },
      { label: "Put the vegetables in the oven to roast", minutes: 35, kind: "passive", resource: oven(220) },
    ],
  },
];

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function score(recipe: Recipe, query: string): number {
  const q = norm(query);
  if (!q) return 0;
  const name = norm(recipe.name);
  if (name === q || recipe.id === q.replace(/ /g, "-")) return 100;
  let s = 0;
  if (name.includes(q)) s += 60;
  const words = q.split(" ").filter((w) => w.length > 2);
  const hay = `${name} ${(recipe.tags ?? []).join(" ")} ${(recipe.ingredients ?? []).join(" ")}`;
  for (const w of words) {
    const stem = w.replace(/(es|s)$/, "");
    if (name.split(" ").some((n) => n.startsWith(stem))) s += 25;
    else if (hay.includes(stem)) s += 10;
  }
  return s;
}

/** Recipes that match a dish name, tag or ingredient, best first. */
export function findRecipes(query: string, recipes: Recipe[] = LIBRARY, limit = 5): Recipe[] {
  return recipes
    .map((r) => ({ r, s: score(r, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.r);
}

/** The single best recipe for a spoken dish name, if it's a confident match. */
export function resolveDish(name: string, recipes: Recipe[] = LIBRARY): Recipe | undefined {
  const best = recipes.map((r) => ({ r, s: score(r, name) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s >= 25 ? best.r : undefined;
}
