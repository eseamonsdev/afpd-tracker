const OLD_PRODUCTION_HOST =
  "afpd-tracker.ericseamonsdeveloper.workers.dev";

const WWW_HOST =
  "www.afpd-accountability.com";

const CANONICAL_ORIGIN =
  "https://afpd-accountability.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      url.hostname === OLD_PRODUCTION_HOST ||
      url.hostname === WWW_HOST
    ) {
      return Response.redirect(
        `${CANONICAL_ORIGIN}${url.pathname}${url.search}`,
        301
      );
    }

    return env.ASSETS.fetch(request);
  }
};
