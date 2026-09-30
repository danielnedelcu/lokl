// The sitemap's dynamic part (@nuxtjs/sitemap): every public market, browse,
// category and listing URL, read as a signed-out visitor, so only public
// pages are listed. Refreshed with the sitemap's own cache.
export default defineSitemapEventHandler(async (event) => {
  try {
    return await publicSitemapEntries(usePublicDb(event));
  } catch (e) {
    console.error("[sitemap]", e);
    return [];
  }
});
