// GET /api/public/homepage-guides. The guides featured at the top of the
// homepage, in order (the first is the hero); empty when none are.
export default defineEventHandler(async (event) => {
  try {
    return await loadHomepageGuides(usePublicDb(event));
  } catch (e) {
    throw publicFailure(e);
  }
});
