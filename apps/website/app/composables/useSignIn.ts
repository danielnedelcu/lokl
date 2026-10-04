// Opens the sign-in dialog (SignInDialog, in app.vue) on the page the person
// is on (docs/design/sign-in-with-code.md). Used by "Sign in to book", the
// hearts and the header's "Sign in".
//
// Signing in by code keeps them on the page; the emailed link brings them
// back to it through /confirm (the module's redirect cookie, set when the
// code is sent).

export interface SignInRequest {
  /** "Sign in to book", "Sign in to save Sweet Auburn Food Walk", "Sign in or sign up". */
  title: string;
  /** Run as the code is sent (the hearts remember what was being saved, for the link). */
  beforeSend?: () => void;
  /** Where focus goes after signing in if the opener is gone ("Sign in to book" is replaced by the form). */
  focusAfter?: string;
}

// Browser only (set on a tap), so one per tab is right.
const current = shallowRef<SignInRequest | null>(null);
let opener: HTMLElement | null = null;
let fallback: string | undefined;

export function useSignIn() {
  function open(request: SignInRequest) {
    if (!import.meta.client) return;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    fallback = request.focusAfter;
    current.value = request;
  }
  /**
   * Closes the dialog and returns a function that puts focus back on what
   * opened it, or, if that's gone, on its stand-in (focusAfter), else the
   * main content. Call it once the page has redrawn for the signed-in person.
   */
  function close() {
    current.value = null;
    const back = opener;
    const instead = fallback;
    opener = null;
    return () => {
      // The stand-in (the account menu, the booking form) can take a moment
      // to appear, so look for it for up to a second.
      let tries = 0;
      const place = () => {
        if (back?.isConnected) return back.focus();
        const stand = instead ? document.querySelector<HTMLElement>(instead) : null;
        if (stand) return stand.focus();
        if (++tries < 20) return void setTimeout(place, 50);
        document.getElementById("main")?.focus();
      };
      place();
    };
  }
  return { current: readonly(current), open, close };
}
