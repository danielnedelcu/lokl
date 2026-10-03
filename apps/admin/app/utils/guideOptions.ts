import type { Category, ServiceArea } from "@repo/types";

// The area and category choices for a guide (the editor and the AI draft
// panel): "None" first, hidden ones marked, categories grouped by kind.
const hidden = (active: boolean) => (active ? "" : " (hidden from the site)");

export function guideAreaOptions(areas: ServiceArea[]) {
  return [{ value: null, label: "None" }, ...areas.map((a) => ({ value: a.id, label: `${a.name}${hidden(a.active)}` }))];
}

export function guideCategoryOptions(categories: Category[]) {
  return [
    { value: null, label: "None" },
    ...categories
      .filter((c) => c.kind === "service")
      .map((c) => ({ value: c.id, label: `${c.name}${hidden(c.active)}`, group: "Services" })),
    ...categories
      .filter((c) => c.kind === "experience")
      .map((c) => ({ value: c.id, label: `${c.name}${hidden(c.active)}`, group: "Experiences" })),
  ];
}
