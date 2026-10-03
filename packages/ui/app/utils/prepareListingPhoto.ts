// Resizes and re-encodes a listing photo in the browser before upload.
//
// - Longest side at most 2,000px, so phone photos stay well under 5 MB.
// - Re-encoded as WebP (JPEG where the browser can't encode WebP).
// - Drawing into a canvas keeps only the pixels, so location (GPS) and other
//   metadata is removed. Photos of a home-based provider's space would
//   otherwise reveal where they live.
// - The EXIF orientation is applied first, so photos aren't sideways.
// - Also makes a card copy about 600px wide for browse cards and thumbnails
//   (docs/design/browse-and-listing-pages.md, Images): WebP, or JPEG where
//   the browser can't encode WebP. iPhone browsers all run Apple's engine,
//   which may not, so the JPEG fallback matters for most phone uploads.
// The bucket's 5 MB limit stays as the fallback check.
//
// Guide photos use the same steps with their own limits (2,400px, 8 MB):
// pass them as options.

export const LISTING_PHOTO_MAX_SIDE = 2000;
export const LISTING_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const LISTING_PHOTO_CARD_WIDTH = 600;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export interface PreparedPhoto {
  blob: Blob;
  ext: "webp" | "jpg";
  width: number;
  height: number;
  /** The card copy, about 600px wide. */
  card: Blob;
  cardExt: "webp" | "jpg";
}

export class PhotoError extends Error {}

export interface PhotoLimits {
  /** Longest side, in pixels. */
  maxSide: number;
  maxBytes: number;
}

export async function prepareListingPhoto(
  file: File,
  limits: PhotoLimits = { maxSide: LISTING_PHOTO_MAX_SIDE, maxBytes: LISTING_PHOTO_MAX_BYTES },
): Promise<PreparedPhoto> {
  if (!ACCEPTED.includes(file.type)) {
    throw new PhotoError("Choose a JPEG, PNG or WebP photo.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoError("That photo couldn't be opened. Try a different one.");
  }

  const scale = Math.min(1, limits.maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const draw = (w: number, h: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
    return canvas;
  };
  const canvas = draw(width, height);
  const cardScale = Math.min(1, LISTING_PHOTO_CARD_WIDTH / bitmap.width);
  const cardCanvas = draw(Math.round(bitmap.width * cardScale), Math.round(bitmap.height * cardScale));
  bitmap.close();

  const encode = (type: string, quality: number, from = canvas) =>
    new Promise<Blob | null>((resolve) => from.toBlob(resolve, type, quality));

  // Browsers that can't encode WebP silently return PNG; check the type.
  let blob = await encode("image/webp", 0.85);
  let ext: PreparedPhoto["ext"] = "webp";
  if (!blob || blob.type !== "image/webp") {
    blob = await encode("image/jpeg", 0.85);
    ext = "jpg";
  }
  if (!blob) throw new PhotoError("That photo couldn't be processed. Try a different one.");

  if (blob.size > limits.maxBytes) {
    const mb = Math.round(limits.maxBytes / 1024 / 1024);
    throw new PhotoError(`This photo is still larger than ${mb} MB after resizing. Choose a smaller photo.`);
  }
  // Same check as the full photo: a browser that can't encode WebP returns PNG.
  let card = await encode("image/webp", 0.8, cardCanvas);
  let cardExt: PreparedPhoto["cardExt"] = "webp";
  if (!card || card.type !== "image/webp") {
    card = await encode("image/jpeg", 0.8, cardCanvas);
    cardExt = "jpg";
  }
  if (!card) throw new PhotoError("That photo couldn't be processed. Try a different one.");
  return { blob, ext, width, height, card, cardExt };
}
