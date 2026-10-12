// Google Identity Services, loaded once, on demand (GoogleSignIn): its
// script is added only when a sign-in form with Google is shown.

interface GoogleIdentity {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        nonce: string;
        callback: (response: { credential: string }) => void;
        auto_select?: boolean;
        use_fedcm_for_prompt?: boolean;
      }): void;
      renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
    };
  };
}

let loading: Promise<GoogleIdentity> | null = null;

export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  const ready = () => (window as unknown as { google?: GoogleIdentity }).google;
  if (ready()?.accounts?.id) return Promise.resolve(ready()!);
  loading ??= new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => (ready()?.accounts?.id ? resolve(ready()!) : reject(new Error("Google sign-in didn't load")));
    script.onerror = () => {
      loading = null;
      reject(new Error("Google sign-in didn't load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}
