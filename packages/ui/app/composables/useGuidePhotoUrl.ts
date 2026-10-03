import { GUIDE_PHOTO_BUCKET } from "@repo/types";

// Public addresses of guide photos (the public guide-photos bucket): the
// full photo, its ~600px card copy, and a srcset offering both so phones
// download the smaller one.
export function useGuidePhotoUrl() {
  const supabase = useSupabaseClient();
  const url = (path: string) => supabase.storage.from(GUIDE_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  return {
    url,
    card: (p: { path: string; card_path: string | null }) => url(p.card_path ?? p.path),
    srcset: (p: { path: string; card_path: string | null; width: number }) =>
      p.card_path ? `${url(p.card_path)} 600w, ${url(p.path)} ${p.width}w` : `${url(p.path)} ${p.width}w`,
  };
}
