// Resizes and re-encodes a listing photo in the browser before upload.
//
// - Longest side at most 2,000px, so phone photos stay well under 5 MB.
// - Re-encoded as WebP (JPEG where the browser can't encode WebP).
// - Drawing into a canvas keeps only the pixels, so location (GPS) and other
//   metadata is removed. Photos of a home-based provider's space would
//   otherwise reveal where they live.
// - The EXIF orientation is applied first, so photos aren't sideways.
// The bucket's 5 MB limit stays as the fallback check.

export const LISTING_PHOTO_MAX_SIDE = 2000;
export const LISTING_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export interface PreparedPhoto {
  blob: Blob;
  ext: "webp" | "jpg";
  width: number;
  height: number;
}

export class PhotoError extends Error {}

export async function prepareListingPhoto(file: File): Promise<PreparedPhoto> {
  if (!ACCEPTED.includes(file.type)) {
    throw new PhotoError("Choose a JPEG, PNG or WebP photo.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoError("That photo couldn't be opened. Try a different one.");
  }

  const scale = Math.min(1, LISTING_PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

  // Browsers that can't encode WebP silently return PNG; check the type.
  let blob = await encode("image/webp", 0.85);
  let ext: PreparedPhoto["ext"] = "webp";
  if (!blob || blob.type !== "image/webp") {
    blob = await encode("image/jpeg", 0.85);
    ext = "jpg";
  }
  if (!blob) throw new PhotoError("That photo couldn't be processed. Try a different one.");

  if (blob.size > LISTING_PHOTO_MAX_BYTES) {
    throw new PhotoError("This photo is still larger than 5 MB after resizing. Choose a smaller photo.");
  }
  return { blob, ext, width, height };
}
