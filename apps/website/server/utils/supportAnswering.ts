// The report routes (provider and admin) turn a SupportError into a plain
// answer; kept apart from supportReports.ts, which stays free of Nuxt so the
// app tests run it.

/** Routes turn SupportErrors into plain answers. */
export async function supportAnswering<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof SupportError) throw createError({ statusCode: e.status, statusMessage: e.message });
    throw e;
  }
}
