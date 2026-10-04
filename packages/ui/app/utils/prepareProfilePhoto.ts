// Prepares a provider's profile photo or cover photo in the browser before
// upload (docs/design/provider-profiles.md, Photos), with the same steps as
// listing photos (prepareListingPhoto.ts): orientation applied, drawn into a
// canvas so location and other metadata are removed, re-encoded as WebP
// (JPEG where the browser can't encode WebP).
//
// - Avatar: the centre square of the photo (the provider sees it before
//   saving), 512 × 512, plus a 128 × 128 copy for small places.
// - Cover: landscape, at least 1,600 × 600, longest side up to 2,400, plus a
//   600-wide card copy. Shown cropped to a band; the preview shows the band.

export const AVATAR_SIZE = 512;
export const AVATAR_SMALL_SIZE = 128;
export const COVER_MIN_WIDTH = 1600;
export const COVER_MIN_HEIGHT = 600;
export const COVER_MAX_SIDE = 2400;
export const COVER_CARD_WIDTH = 600;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export interface PreparedProfilePhoto {
  /** The photo itself: the 512px square, or the cover. */
  blob: Blob;
  /** The smaller copy: the 128px square, or the 600px-wide cover card. */
  small: Blob;
  ext: "webp" | "jpg";
  width: number;
  height: number;
}

export class ProfilePhotoError extends Error {}

async function open(file: File) {
  if (!ACCEPTED.includes(file.type)) throw new ProfilePhotoError("Choose a JPEG, PNG or WebP photo.");
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ProfilePhotoError("That photo couldn't be opened. Try a different one.");
  }
}

/** Draws part of the bitmap (sx, sy, sw, sh) at w × h, and encodes it. */
async function encode(bitmap: ImageBitmap, src: [number, number, number, number], w: number, h: number, quality: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, ...src, 0, 0, w, h);
  const as = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  // Browsers that can't encode WebP silently return PNG; check the type.
  const webp = await as("image/webp");
  if (webp && webp.type === "image/webp") return { blob: webp, ext: "webp" as const };
  const jpeg = await as("image/jpeg");
  if (!jpeg) throw new ProfilePhotoError("That photo couldn't be processed. Try a different one.");
  return { blob: jpeg, ext: "jpg" as const };
}

export async function prepareAvatar(file: File): Promise<PreparedProfilePhoto> {
  const bitmap = await open(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    if (side < AVATAR_SMALL_SIZE) throw new ProfilePhotoError(`This photo is too small. Choose one at least ${AVATAR_SMALL_SIZE} pixels on each side.`);
    // The centre square.
    const crop: [number, number, number, number] = [(bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side];
    const size = Math.min(AVATAR_SIZE, side);
    const main = await encode(bitmap, crop, size, size, 0.85);
    const small = await encode(bitmap, crop, AVATAR_SMALL_SIZE, AVATAR_SMALL_SIZE, 0.85);
    if (main.blob.size > MAX_BYTES) throw new ProfilePhotoError("This photo is still larger than 5 MB after resizing. Choose a smaller photo.");
    return { blob: main.blob, small: small.blob, ext: main.ext, width: size, height: size };
  } finally {
    bitmap.close();
  }
}

export async function prepareCover(file: File): Promise<PreparedProfilePhoto> {
  const bitmap = await open(file);
  try {
    if (bitmap.width < COVER_MIN_WIDTH || bitmap.height < COVER_MIN_HEIGHT || bitmap.width <= bitmap.height) {
      throw new ProfilePhotoError(
        `The cover photo needs to be landscape and at least ${COVER_MIN_WIDTH.toLocaleString("en-US")} × ${COVER_MIN_HEIGHT} pixels (this one is ${bitmap.width} × ${bitmap.height}).`,
      );
    }
    const whole: [number, number, number, number] = [0, 0, bitmap.width, bitmap.height];
    const scale = Math.min(1, COVER_MAX_SIDE / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const main = await encode(bitmap, whole, width, height, 0.85);
    const card = await encode(bitmap, whole, COVER_CARD_WIDTH, Math.round((COVER_CARD_WIDTH * bitmap.height) / bitmap.width), 0.8);
    if (main.blob.size > MAX_BYTES) throw new ProfilePhotoError("This photo is still larger than 5 MB after resizing. Choose a smaller photo.");
    return { blob: main.blob, small: card.blob, ext: main.ext, width, height };
  } finally {
    bitmap.close();
  }
}

export const PROVIDER_PHOTO_BUCKET = "provider-photos";
