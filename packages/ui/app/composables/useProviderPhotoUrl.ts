// Public addresses of provider profile photos (the public provider-photos
// bucket; docs/design/provider-profiles.md).
export function useProviderPhotoUrl() {
  const supabase = useSupabaseClient();
  return (path: string | null | undefined) =>
    path ? supabase.storage.from(PROVIDER_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl : null;
}
