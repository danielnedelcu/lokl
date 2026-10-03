# Destination guides

Build step 7 (docs/TODO.md). Reviewed 2026-10-03; the answers are under
"Settled questions" and folded into the sections below.

A guide is an article about a place or theme in Atlanta ("Things to do in Old
Fourth Ward", "The best food tours in Atlanta"), written to be found through
search, that recommends real lokl listings. Only the admin writes guides, in
the admin app, starting from an AI draft or from scratch.

## Decisions already made

From the owner, 2026-10-03.

1. **What a guide is:** an article about a place or theme in Atlanta, written to be found through search, recommending real lokl listings.
2. **Who writes them:** only the admin, in the admin app. Providers don't.
3. **AI drafts:** the admin describes the guide in one brief (the topic, angle and what they know), with the guide's area and category; the admin app asks Claude for a draft through Anthropic's API. The key lives only on the admin app's server.
4. **Accuracy:** drafts stick to general, lasting description and avoid specifics that go stale (prices, opening hours). A draft can never be published without the admin's review: the editor marks it as an unreviewed AI draft until it's been edited.
5. **Listings:** each guide shows a live block of matching listings, by area or category, not links pasted into the text, so taken-down listings disappear on their own.
6. **Photos:** the admin's own, or properly licensed free photos (for example Unsplash), with credits shown as their licence asks. Every guide needs a cover photo, large and high quality enough for the homepage hero, with a minimum size.
7. **Where they live:** `/atlanta/guides/<slug>`, a guides index page, the sitemap, and article structured data. Statuses: draft, published, unpublished, with "last updated" shown.
8. **The editor:** may follow the pattern of the blog project's editor (read only; nothing copied).
9. **The homepage:** guides at the very top: one large hero guide, then three or four smaller guide cards, each with its photo and, underneath it (never over it), the title and a short teaser. The admin chooses which guides are featured, in what order, and which is the hero. Each guide has a teaser field for this. With no guides published, the homepage keeps its current headline. On phones, the hero is full width and the smaller cards stack.

## What the blog editor teaches (surveyed 2026-10-03, read only)

Worth reusing:
- **Draft and live copies.** Editing a published post writes to draft fields; "Publish" copies them over the live ones and snapshots a version. Readers never see half-finished edits.
- **Debounced autosave** (about 1.5 seconds after typing stops), with the save state shown.
- **Live slug check** against the existing slugs; publishing waits for a valid slug.
- **The prompt in its own file**, with a strict JSON reply, and **AI usage and cost logged**.
- **A block editor** (Editor.js), storing the body as block JSON rather than HTML.

To avoid:
- The AI route has **no sign-in check**. Here it calls `requireAdmin` first.
- **Images stored as base64 inside the body.** Here every image is an uploaded, resized file with alt text and a credit.
- **The public page inserts the body as raw HTML** (`v-html`) without cleaning it. Here the body is rendered from its blocks by lokl's own renderer: text is always escaped, and only bold, italic and links are allowed inline.
- **AI output replaces the content with no marker or review.** Here it's marked unreviewed and can't be published until reviewed (below).
- **No alt text, credits, canonical tag, structured data or sitemap.** All are covered here.

## Tables and access rules

One migration. All guide tables are **read by admins, written by admins**
(`public.is_admin()`), like categories and cities; visitors read only published
guides, through the website's server.

### guides

| Column | Notes |
| --- | --- |
| `id`, `market_id` | Atlanta for now (`cities`) |
| `slug` | Unique per market; letters, numbers and hyphens; checked live in the editor |
| `title`, `teaser`, `body` | The **live** copy. `teaser`: up to 160 characters, shown under the photo on cards and the homepage, and used as the meta description. `body`: block JSON (see "The editor") |
| `draft_title`, `draft_teaser`, `draft_body`, `draft_cover_photo_id`, `draft_area_id`, `draft_category_id`, `draft_listing_kind` | The **draft** copy: what the editor edits, and the only guide content admins write directly. Publishing copies it to the live columns |
| `cover_photo_id` | The live cover (`guide_photos`); required to publish |
| `area_id`, `category_id`, `listing_kind` | The **live** listings block, which the public pages read: listings in this area and/or this category. Like the rest of the live copy, only publishing changes it, so editing the draft area of a published guide doesn't change its page. At most one of each, and at least one of the two (settled). `listing_kind` limits it to Services or Experiences (optional) |
| `status` | `draft`, `published`, `unpublished` |
| `ai_draft_pending_review`, `ai_reviewed_by`, `ai_reviewed_at` | True from the moment an AI draft lands in the body until the admin marks it reviewed (see "Review"); who confirmed and when |
| `published_at`, `content_updated_at` | First publish; last time the live text or cover changed ("Last updated" on the page and `dateModified` in structured data). Featuring a guide doesn't change it |
| `created_at`, `updated_at` | |

Rules in the database (a trigger, with pgTAP tests each way):
- **Publishing needs** a title, a teaser, a valid slug, a landscape cover photo of at least 1,600 × 900, an area or a category, and `ai_draft_pending_review = false`. It refuses otherwise, with a plain sentence for each.
- A guide's area has to belong to the guide's market.
- `status` moves `draft → published → unpublished → published`, and only the server changes it: the admin app's publish and unpublish routes (settled: the admin rule that status changes go through a server route). Admins write everything else directly. A published guide's slug can't change (its address is in search results). Unpublishing takes it off the homepage too (below).

### guide_photos

| Column | Notes |
| --- | --- |
| `id`, `guide_id` | |
| `storage_path`, `card_path` | In a new public bucket `guide-photos`: the photo (longest side at most 2,400px) and a card copy about 600px wide, as listing photos do. Both have to be in `<guide_id>/`, the guide's own folder (checked by the database, as for listing photos) |
| `width`, `height` | Of the stored photo; the cover rule checks them. **Reported by the browser at upload, not measured by the server**: the editor resizes the photo in the browser and sends its size. An admin could send the wrong numbers; the only effect is a cover that passes or fails the size rule wrongly, and only admins upload. Measure on the server if uploads ever open to anyone else |
| `alt_text` | Required, up to 200 characters |
| `source` | `own` (the admin's photo), `unsplash`, or `other` (another licence) |
| `credit_name`, `credit_url`, `source_url`, `licence` | Required unless `source = own`; see "Photos and credits" |

### guide_versions

A snapshot of the live copy (title, teaser, body, cover, listings block) each time the guide is
published, with who and when. Includes the listings block's area, category and kind. Read by admins; written by `publish_guide()`.
Lets the admin see what was live before.

### guide_ai_drafts

Every AI draft request: the topic, area, category and notes sent, the model,
the reply, tokens and cost, who and when. Read by admins; written by the admin
app's server. It's the record of what came from the AI, and the cost log.

### homepage_features

| Column | Notes |
| --- | --- |
| `position` | 1 to 5; **1 is the hero**, 2 to 5 are the smaller cards. Unique |
| `guide_id` | Unique; a published guide |

Read by everyone (the homepage); written by admins. Unpublishing a guide
removes its row (trigger), so the homepage never links to a guide that's gone.

### Access, in one table

| Table | Visitors | Admins | Server |
| --- | --- | --- | --- |
| guides | Published guides' live columns, through the website's server only | All, write | Reads |
| guide_photos | Photos of published guides (the bucket is public; paths are unguessable) | All, write | Reads |
| guide_versions, guide_ai_drafts | None | Read | Writes |
| homepage_features | Read | Read, write | Reads |

The public site reads guides with the service key in its server routes, picking
only the live columns of published guides (the same way public listing pages
work today), so draft columns never reach the browser. Delete behaviour: guides
are unpublished, never deleted, once published; a guide that was never
published can be deleted with its photos.

## The AI draft

**Where it runs:** a server route in the admin app, `POST /api/guides/:id/draft`,
behind `requireAdmin`. The key is `NUXT_ANTHROPIC_API_KEY` in
`apps/admin/.env`, server only (never `NUXT_PUBLIC_`), which you'll create.
The route calls the Messages API with the official SDK (`@anthropic-ai/sdk`),
model `claude-opus-5-5` (settled; `NUXT_ANTHROPIC_MODEL` to change it). The key
is in its own Anthropic workspace for lokl, with a spend limit.

**What the admin gives (changed 2026-10-03):** one brief, in their own words:
what the guide is about ("Things to do in Old Fourth Ward"), the angle, places
they know, what to mention or leave out. The area and category are the
guide's own, from Guide settings. The brief is sent to Anthropic, so the bar
says not to put personal details in it. The log keeps the whole brief, and
its first line as the draft's label. (It replaced separate topic and notes
fields.)

**What comes back:** JSON in a fixed shape, enforced by the API's structured
outputs (`output_config.format`, `GUIDE_DRAFT_SCHEMA`) and checked again with
zod: a suggested title, teaser (up to 160 characters), slug, and the body as
blocks (headings, subheadings, paragraphs, lists; no images, no links). Opus 5.5
doesn't accept a forced tool choice, so the design's original "one tool" became
structured outputs (2026-10-03). The text is escaped as it becomes the editor's
blocks, so the model can't add HTML or links. It lands in the draft columns
only if the guide hasn't changed since the editor saw it, sets
`ai_draft_pending_review`, and is logged in `guide_ai_drafts` with the draft
from before (`previous_draft`), so "Put back the draft from before" can undo
the latest AI draft, once. The suggested address is offered ("Use it"), never
applied.

**How the prompt keeps drafts general.** The system prompt (in its own file,
`apps/admin/server/prompts/guide-writer.ts`) tells the model to:
- Write about what lasts: the character of the area, what it's known for, what
  kinds of things there are to do, how to spend a morning or an afternoon,
  getting around in general terms, the feel through the seasons.
- **Never state** prices, opening hours, dates, schedules, phone numbers,
  addresses, ticket details, "new", "currently", "this year", rankings or
  ratings, or anything about a named business's offering. Not to invent
  facts; to stay general where unsure.
- **No superlatives** ("best", "top", "must-see", "number one"), in the
  title, teaser or body (settled). The admin can still write them.
- Not to name or recommend specific businesses, including lokl's providers:
  the listings block does that, and stays current on its own. Where the guide
  would recommend booking something, say so in general terms ("a guided food
  walk is a good way to start"), and the listings block below shows what's
  bookable.
- Use the admin's notes as the main source; plain, warm, clear sentences; short
  paragraphs; about 600 to 900 words; headings a reader can scan.
- No stock travel-writing phrases ("hidden gem", "vibrant", "bustling",
  "nestled", "something for everyone", "a feast for the senses", "whether
  you're a local or a visitor"): concrete, observable detail about lasting
  public places instead (added by the owner 2026-10-03).

The full prompt is in `apps/admin/server/prompts/guide-writer.ts`.

**A second check after the reply.** The route scans the draft for things that
go stale or shouldn't be there, and the editor highlights them for the admin:
money amounts, times of day, days of the week next to times, years, phone
numbers, web addresses, street addresses, words like "currently", "new",
"best", "top-rated", and the stock phrases the prompt bans. It doesn't change
the text; it points. The scanner is `findStalePhrases()` in `@repo/types`; the
editor runs it again as the admin edits, lists each phrase with its reason
under the review banner, and highlights it in the text with the browser's
highlight feature (`CSS.highlights`), which never changes what's saved.

**Limits.** One request at a time per guide (a request logged in the last 3
minutes without a result counts as running), and at most 10 an hour across
all guides (`AI_DRAFTS_PER_HOUR`). Every request is logged, including
failures, with its tokens and cost (Opus 5.5 at $4 / $20 per million input /
output tokens, `MODEL_PRICES`). The editor lists each guide's AI drafts with
their cost; the guides list shows the month's total.

## Review

An AI draft can't be published until the admin has reviewed it. The editor
shows a banner on the draft: "AI draft, not reviewed yet. Check every fact
before publishing." Flagged phrases are highlighted.

"Mark as reviewed" clears it. It asks the admin to confirm two things first:
"I've checked every highlighted phrase" and "I've checked the facts"
(settled 2026-10-03; editing isn't required). The confirmation is recorded
with who and when (`ai_reviewed_by`, `ai_reviewed_at`). The database refuses to
publish while `ai_draft_pending_review` is true, so no code path can skip it. A
new AI draft on the same guide sets it again.

## The editor (admin app)

Following the blog's pattern, with its gaps closed:

- **Layout (changed 2026-10-03):** the title and the body (Editor.js: headings,
  paragraphs, lists, quotes, and images from the guide's own photos) take the
  whole width. "Guide settings" (top right) opens a panel from the right with
  the status and actions, slug (checked live), teaser (with a character count),
  area, category and listing kind, and photos.
- **Guides list (changed 2026-10-03):** a list, not a table, with tabs for All,
  Published (live, with or without changes waiting) and Draft (not live:
  never published or unpublished). Each row shows the title, status, city and
  last edit, and icon buttons with tooltips: Edit post, View post (a live guide
  opens on the website; any other, the draft preview) and Delete post (asks
  first; only for guides never published, which the database enforces).
- **New guide (changed 2026-10-03):** creates an empty guide straight away and
  opens it (with several cities, it asks which first). Its address is a
  placeholder (`new-guide-…`) that follows the title, typed or from an AI draft,
  until the admin types an address by hand or the guide is first published.
- **Saving:** autosave about 1.5 seconds after typing stops, with "Saved" or
  "Couldn't save, retrying" shown; errors are handled, not lost.
- **Draft and live:** the editor always edits the draft columns. On a published
  guide the panel says "Changes not published yet" with "Publish changes"; on a
  draft, "Publish". Publishing snapshots a version.
- **AI draft (changed 2026-10-03):** a "Write with AI" button floats at the
  bottom of the editor and opens a prompt bar: one box for the brief (Enter
  sends, Shift+Enter is a new line, Escape closes), with this guide's AI drafts
  and "Put back the draft from before" under it. On a guide that already has
  text: "This replaces the current draft. Continue?"
- **Listings block preview:** the editor shows the listings the block would
  show right now (live, matching listings), and says plainly when there are
  none ("No live listings match yet: the block will be hidden").
- **Preview:** "Preview" opens the guide as it will look on the site.
- **Publish checks** are listed as they apply: cover photo missing or too
  small, teaser missing, not reviewed, no area or category.
- **Body rules:** headings are level 2 or 3 only, since the guide's title is
  the page's main heading (h1). Lists aren't nested. Photo blocks store only
  the photo's id. The body is checked against `guideBodySchema` before every
  save.
- **Links** in the body are kept only when they start with `https://` or `/`.
  Links to other sites are drawn with `rel="noopener noreferrer"`.
- **Accessibility:** Editor.js is weaker for keyboard and screen-reader use
  than a plain form (its block menus and inline toolbar are mouse-first).
  That's acceptable because only the admin edits guides, and the public page
  is drawn by lokl's own renderer (`GuideBody`), not by Editor.js.
- **Photos on the published page:** a photo the published version uses (its
  cover, or its body while it's live) can't be deleted until a version
  without it is published. The database enforces this for the cover; for
  photos in the body only the editor checks, and the page skips a missing
  photo rather than breaking (settled 2026-10-03).
- **Versions:** "Copy into draft" asks first: "This replaces your current
  draft. Your published guide isn't affected."
- **Two tabs:** each save goes through only if the guide hasn't changed since
  the tab last saw it; otherwise saving stops and the editor asks to reload.

## Photos and credits

- **Upload, in the browser, like listing photos:** resized so the longest side
  is at most 2,400px, re-encoded as WebP (JPEG where the browser can't),
  metadata (including location) removed, and a ~600px card copy made. Stored in
  the public `guide-photos` bucket; 8 MB limit.
- **The cover's minimum size: 1,600 × 900 pixels, landscape** (lowered from
  2,000 × 1,125 on 2026-10-03; see `docs/decisions.md`). The editor offers
  "Use as cover" only on photos that meet it and says why otherwise, and the
  database refuses a smaller cover at publish. Photos in the body have no
  minimum.
- **Credits.** Each photo records its source:
  - *Own photo:* no credit needed (optional "Photo: …").
  - *Unsplash:* "Photo by {name} on Unsplash", linking to the photographer's
    Unsplash profile and to Unsplash, as Unsplash asks. The editor takes the
    photo's Unsplash page address and the photographer's name.
  - *Other licence:* the credit line, the licence name and the source address
    are required; the editor asks the admin to confirm the licence allows
    commercial use.
- **Where credits show:** under the cover on the guide page ("Photo by … on
  Unsplash"), and under each inline photo. Homepage and index cards don't
  repeat credits (the guide page carries them).
- **No Unsplash API search inside the editor** (see Flags): photos are
  downloaded from Unsplash's site and uploaded like any other.

## Public pages and SEO

- **`/atlanta/guides`:** the guides index. Every published guide, most
  recently updated first, as cards (photo, title, teaser underneath). Indexed.
- **`/atlanta/guides/<slug>`:** the guide. The cover with its credit, the
  title (H1), "By lokl Atlanta · Last updated {date}", the body (rendered by lokl's renderer
  from the blocks), and the **listings block**: "Book in Old Fourth Ward" (or
  the category), up to six live listings matching the guide's area and/or
  category and kind, as the usual listing cards, with "See all" linking to the
  matching browse page. If none match, the block is hidden. Unpublished or
  draft guides return the generic 404.
- **Area matching:** a listing matches an area if it's in that area, or (for
  "I come to you" Services) if the area is one it travels to.
- **SEO:**
  - Title from the guide's title; meta description from the teaser; canonical
    URL; Open Graph and Twitter cards with the cover photo.
  - `Article` structured data (JSON-LD): headline, image, `datePublished`,
    `dateModified` (from `content_updated_at`), author "lokl Atlanta" (settled)
    and publisher lokl, plus
    `BreadcrumbList` (Atlanta › Guides › title).
  - The sitemap lists the index and every published guide, with `lastmod`.
  - The market page `/atlanta` links to the guides index.
- **Caching:** like browse pages, guide pages may be cached for up to 60
  seconds; the listings block inside them is part of that. A cached copy is
  never served past its minute (no stale-while-revalidate), so an
  unpublished guide's address is a 404 within a minute (2026-10-03).
- **First publish and the address:** the address can't change once
  published, so the first publish asks to confirm it. If it doesn't match
  the address the current title suggests, the confirmation says so and
  offers "Use the suggested address and publish" in one click (or says the
  suggested address is taken by another guide).
- **How visitors read guides (decided 2026-10-03):** through database
  functions, not the website's server key: `public_guides(market)`,
  `public_guide(market, slug)` and `public_homepage_guides()` return only
  published guides in public markets, only their live copy (never a draft
  column, the AI review fields or who wrote it), and only the photos the
  live copy uses. pgTAP checks each of these.

## The homepage

When at least one guide is featured (`homepage_features` has a row whose guide
is published), the top of the homepage is:

1. **The hero guide** (position 1): its cover large, full width of the content
   area, and **underneath it** the title (large) and the teaser, all one link
   to the guide.
2. **Four smaller guide cards** (positions 2 to 5; settled): cover photo, then
   the title and teaser underneath. Four in a row on wide screens, two on
   tablets, stacked on phones. Fewer chosen, fewer shown.
3. **Then the headline and the browse links** ("Browse Experiences", "Browse
   Services"), just below the guides (settled), then "On lokl now".

**Without a featured, published guide**, the homepage is exactly as today,
headline first.

**Headings (decided 2026-10-03):** with guides first, the page's `h1` is
still the headline ("Book local Experiences and Services in Atlanta"),
first in the page and visually hidden; the guides follow under a visible
"Guides to Atlanta" heading, and the visible headline below them keeps its
look but isn't a heading.

**Choosing them:** the admin app's Content › Homepage page: up to five
published guides, reordered with up and down buttons (the first is the
hero), with a preview drawn by the website's own component. Saved in one
step (`admin_set_homepage_features`), so the homepage is never half-changed.

Text is never over the photo. Images get proper `alt` text, sizes (`srcset`)
so phones download the smaller copy, and the hero loads first (high priority,
no lazy loading); the other cards lazy-load.

## What the admin app needs

- **Guides** (`/content`, replacing the placeholder): every guide with its
  status, last updated, whether it's featured, and "New guide".
- **The editor** (`/content/<id>`): as above.
- **Homepage** (a new page, or a section on Guides): choose up to five published
  guides, order them with up and down buttons (keyboard-friendly, no
  drag-and-drop needed), position 1 being the hero; a live preview of the top
  of the homepage.
- **Server routes**, each behind `requireAdmin`: `POST /api/guides/:id/draft`
  (the AI draft), `POST /api/guides/:id/publish` (also "Publish changes") and
  `POST /api/guides/:id/unpublish`. Everything else (the draft text, photos,
  review, homepage order) is direct writes under the admin-only database
  rules, like categories; the publish rules are enforced by the database.
- **Packages:** `@anthropic-ai/sdk` and Editor.js (and its tool plugins) in
  the admin app; the renderer in the shared layer or the website.
- **Settings:** `NUXT_ANTHROPIC_API_KEY` (you'll create it),
  `NUXT_ANTHROPIC_MODEL` (optional), in `apps/admin/.env` and `.env.example`.

## Flags (resolved 2026-10-03)

Kept for the reasoning; each is settled under "Settled questions".

1. **"Unreviewed until I've edited it"** (decision 4): editing isn't the same
   as checking. A one-character change would clear it. The design asks for both:
   the body edited since the draft, and an explicit "Mark as reviewed". See open
   question 1.
2. **Unsplash's API** would let the editor search photos, but its rules require
   showing the images from Unsplash's own servers and reporting each use back to
   Unsplash. The site loads nothing from other sites today (the homepage
   decision of 2026-09-30), so the design uses downloaded-and-uploaded photos
   with credits instead.
3. **"The best food tours in Atlanta"** (decision 1, example title): a guide
   that says "best" while the block shows whatever lokl listings match could
   read as a ranking lokl can't stand behind. The prompt avoids rankings in the
   body; titles are the admin's choice. See open question 4.
4. **Publishing as a direct write.** The admin app's rule is that status changes
   go through a server route. Guides are admin-only content (nothing crosses
   users or touches money), so the design writes them directly under admin-only
   rules, like categories and cities, with the publish rules enforced in the
   database. If you'd rather keep the server-route rule, publishing becomes a
   small admin route.
5. **The brief goes to Anthropic.** The admin's brief is sent to
   Anthropic's API. Nothing about customers or providers is sent, and the editor
   says not to include personal details.
6. **The homepage's current headline moves down** when guides are featured
   (decision 9 says the guides go at the very top). The browse buttons stay
   just below the guides. See open question 3.

## Settled questions

Answered by the owner, 2026-10-03.

1. **Review:** no edit required; "Mark as reviewed" asks the admin to confirm
   they've checked the highlighted phrases and the facts.
2. **Featured cards:** four.
3. **Homepage order:** guides first; the headline and browse links just below.
4. **Superlatives:** AI drafts avoid "best" and the like; the admin can still
   write them.
5. **Areas and categories:** at most one of each per guide, and at least one.
6. **Byline:** "lokl Atlanta".
7. **Model:** Opus (`claude-opus-5-5`).
8. **Cover minimum:** 2,000 × 1,125, later lowered to 1,600 × 900 (2026-10-03).
9. **Flags:** no Unsplash API (photos are downloaded from unsplash.com and
   uploaded with their credit); publishing and unpublishing go through admin
   server routes; notes going to Anthropic are fine, with private information
   kept out of them.

## Tests

- pgTAP: the publish rules (each refusal and the allowed case); slug locked
  once published; unpublishing removes a homepage feature; visitors can't read
  drafts, versions or AI logs; admins read and write; non-admins can't write.
- App tests: the AI draft route refuses non-admins and works with a fake model
  client; the stale-phrase scan finds each pattern; the renderer escapes text
  and allows only the expected inline formatting; the public guide route
  returns only live columns of published guides.
- Walkthrough: write a guide from an AI draft, review, publish, feature it as
  the hero, check the homepage on a phone and a laptop, unpublish it.

## Build order

1. Database: the tables, rules, bucket and tests (shown before `db:push`).
2. The admin editor without AI: write, photos with credits, publish, versions.
3. The AI draft: the route, the prompt, the stale-phrase scan, the review step.
4. Public pages: index, guide page, listings block, SEO, sitemap.
5. The homepage: features in the admin app, the hero and cards on the site.

## Out of scope

- Comments, likes, or sharing buttons.
- Guides for other markets (the tables carry `market_id`, ready).
- AI images.
- Scheduling a publish for later (the blog has it; not needed yet).
