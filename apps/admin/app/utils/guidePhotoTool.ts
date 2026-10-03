import type { BlockAPI, BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";

// The guide editor's "Photo" block: one of the guide's own photos, chosen by
// id (docs/design/destination-guides.md). The body stores only the id and an
// optional caption; alt text and the credit come from the photo's row. A
// block left without a photo is dropped when the body is saved.

export interface PhotoOption {
  id: string;
  url: string;
  alt: string;
}

export interface PhotoToolConfig {
  /** The guide's photos, read each time the list opens (so new uploads appear). */
  photos: () => PhotoOption[];
}

interface PhotoData {
  photoId?: string;
  caption?: string;
}

// Lucide "image", as Editor.js's toolbox needs an SVG string.
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';

// Captions are stored like the rest of the body's text: as inline HTML, so
// "<" and "&" are written as entities and the renderer shows them as typed.
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

let counter = 0;

export class GuidePhotoTool implements BlockTool {
  static get toolbox() {
    return { title: "Photo", icon: ICON };
  }

  static get isReadOnlySupported() {
    return true;
  }

  private data: PhotoData;
  private config: PhotoToolConfig;
  private block: BlockAPI;
  private select!: HTMLSelectElement;
  private caption!: HTMLInputElement;
  private preview!: HTMLImageElement;
  private empty!: HTMLParagraphElement;

  constructor({ data, config, block }: BlockToolConstructorOptions<PhotoData, PhotoToolConfig>) {
    this.data = data ?? {};
    this.config = config!;
    this.block = block;
  }

  private fillOptions() {
    const photos = this.config.photos();
    const current = this.select.value || this.data.photoId || "";
    this.select.replaceChildren(new Option("Choose a photo", ""));
    for (const p of photos) this.select.add(new Option(p.alt, p.id));
    // A photo that has since been deleted stays visible as missing.
    if (current && !photos.some((p) => p.id === current)) this.select.add(new Option("(Deleted photo)", current));
    this.select.value = current;
    this.empty.hidden = photos.length > 0;
    this.showPreview();
  }

  private showPreview() {
    const photo = this.config.photos().find((p) => p.id === this.select.value);
    this.preview.hidden = !photo;
    if (photo) {
      this.preview.src = photo.url;
      this.preview.alt = photo.alt;
    }
  }

  render() {
    const n = ++counter;
    const wrap = document.createElement("div");
    wrap.className = "guide-photo-block";
    wrap.innerHTML = `
      <label for="guide-photo-${n}">Photo</label>
      <select id="guide-photo-${n}"></select>
      <p class="guide-photo-empty">Add photos in the Photos section first.</p>
      <img alt="" hidden>
      <label for="guide-photo-caption-${n}">Caption (optional)</label>
      <input id="guide-photo-caption-${n}" type="text" maxlength="300">`;
    this.select = wrap.querySelector("select")!;
    this.empty = wrap.querySelector("p")!;
    this.preview = wrap.querySelector("img")!;
    this.caption = wrap.querySelector("input")!;
    this.caption.value = unescape(this.data.caption ?? "");
    this.fillOptions();
    this.select.addEventListener("focus", () => this.fillOptions());
    // Typing in a field doesn't change the page's markup, so tell Editor.js.
    this.select.addEventListener("change", () => {
      this.showPreview();
      this.block.dispatchChange();
    });
    this.caption.addEventListener("input", () => this.block.dispatchChange());
    // Editor.js handles Enter and Backspace itself; inside these fields they
    // should just type.
    for (const el of [this.select, this.caption]) el.addEventListener("keydown", (e) => e.stopPropagation());
    return wrap;
  }

  save(): PhotoData {
    const caption = this.caption.value.trim();
    return { photoId: this.select.value || undefined, ...(caption ? { caption: escape(caption) } : {}) };
  }

  validate(data: PhotoData) {
    return !!data.photoId;
  }
}
