// A form's save messages (the toasts), one form at a time: when a new save
// starts, the previous save's message goes, so a "saved" on screen always
// belongs to the latest save. Without it, saving twice in a few seconds left
// the first "saved" showing while the second was refused (seen in journey
// 27, 2026-10-21: a test read it as the second save's success).
//
//   const messages = useSaveMessages();
//   const save = () => { messages.start(); return submit(); };
//   ...in the handler: messages.success("Weekly hours saved.") or messages.error(...)

export function useSaveMessages() {
  let last: string | number | undefined;
  return {
    /** A new save or change is starting: take down this form's last message. */
    start() {
      if (last !== undefined) useSonner.dismiss(last);
      last = undefined;
    },
    success(text: string) {
      last = useSonner.success(text);
    },
    error(text: string) {
      last = useSonner.error(text);
    },
  };
}
