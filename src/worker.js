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

    const statusKeys = new Map([
      ["/police-radio-status.html", "police-radio-status.html"],
      ["/radio-status/staging.json", "radio-status/staging.json"],
      ["/radio-status/law-2-radio.json", "radio-status/law-2-radio.json"]
    ]);
    if (statusKeys.has(url.pathname) && env.RADIO_AUDIO) {
      if (!["GET", "HEAD"].includes(request.method)) return new Response(null, {status: 405});
      const object = await env.RADIO_AUDIO.get(statusKeys.get(url.pathname));
      if (!object) return new Response("Status has not been published yet", {status: 404});
      return new Response(request.method === "HEAD" ? null : object.body, {headers: {
        "Content-Type": url.pathname.endsWith(".json") ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }});
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
