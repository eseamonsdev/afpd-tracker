import { r2RadioAudio } from "./r2-radio-audio.js";

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

    const response = await env.ASSETS.fetch(request);
    if (response.status === 404) {
      const audio = await r2RadioAudio(request, env.RADIO_AUDIO);
      if (audio) return audio;
    }

    if (
      url.pathname.startsWith("/records/citizen-provided/daniel-sroka-meeting-transcript-drafts/") &&
      url.pathname.endsWith(".txt") &&
      response.headers.get("Content-Type")?.split(";")[0].trim() === "text/plain"
    ) {
      const encodedResponse = new Response(response.body, response);
      encodedResponse.headers.set("Content-Type", "text/plain; charset=utf-8");
      return encodedResponse;
    }

    return response;
  }
};
