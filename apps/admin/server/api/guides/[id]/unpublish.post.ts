
// Unpublish: takes a published guide off the site and the homepage. Its
// address stops working until it's published again.
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event, { owner: true });
  try {
    // The server key acting for this admin's session (publish_guide checks it).
    return await runGuideAction(admin.db, "unpublish", getRouterParam(event, "id") ?? "", admin.sub);
  } catch (e) {
    if (e instanceof GuideActionError) throw createError({ statusCode: e.status, statusMessage: e.message });
    throw e;
  }
});
