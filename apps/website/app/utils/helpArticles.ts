import { parseHelpArticle, type HelpArticle, type HelpAudience } from "./helpArticle";

// Every Help centre article, read from apps/website/content/help when the
// site is built (Vite's import.meta.glob), in each audience's order.
const files = import.meta.glob("../../content/help/**/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const HELP_ARTICLES: HelpArticle[] = Object.entries(files)
  .map(([path, raw]) => parseHelpArticle(path.replace(/^.*content\/help\//, ""), raw))
  .sort((a, b) => a.audience.localeCompare(b.audience) || a.order - b.order || a.title.localeCompare(b.title));

export const helpArticle = (slug: string) => HELP_ARTICLES.find((a) => a.slug === slug);
export const helpArticlesFor = (audience: HelpAudience) => HELP_ARTICLES.filter((a) => a.audience === audience);
