// The information pages' Markdown (content/pages/<slug>.md), read when the
// site is built; InfoPageView fills in their facts and shows them.
const files = import.meta.glob("../../content/pages/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const INFO_PAGES: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, raw]) => [path.replace(/^.*\//, "").replace(/\.md$/, ""), raw]),
);
