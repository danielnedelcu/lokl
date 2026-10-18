// The signed-in person's authenticators and where their session stands
// (docs/design/admin-roles.md): "aal1" after the emailed code, "aal2" once
// they've passed the second step. Supabase's own MFA API, in the browser
// (this app renders only there).
export interface Authenticator {
  id: string;
  name: string;
  createdAt: string;
}

export function useAuthenticators() {
  const supabase = useSupabaseClient();
  const authenticators = useState<Authenticator[]>("authenticators", () => []);
  const level = useState<{ current: string | null; next: string | null }>("aal", () => ({ current: null, next: null }));
  const loaded = useState("authenticators-loaded", () => false);

  async function refresh() {
    const [factors, aal] = await Promise.all([supabase.auth.mfa.listFactors(), supabase.auth.mfa.getAuthenticatorAssuranceLevel()]);
    if (factors.error) throw factors.error;
    if (aal.error) throw aal.error;
    authenticators.value = (factors.data?.totp ?? [])
      .filter((f) => f.status === "verified")
      .map((f) => ({ id: f.id, name: f.friendly_name ?? "Authenticator", createdAt: f.created_at }));
    level.value = { current: aal.data.currentLevel, next: aal.data.nextLevel };
    loaded.value = true;
  }

  /** Signed in with the emailed code, with an authenticator still to pass. */
  const needsSecondStep = computed(() => level.value.current === "aal1" && level.value.next === "aal2");

  return { authenticators, level, loaded, needsSecondStep, refresh };
}
