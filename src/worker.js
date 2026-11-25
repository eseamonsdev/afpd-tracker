import { r2RadioAudio } from "./r2-radio-audio.js";
import { r2OfficerPhoto } from "./r2-officer-photos.js";
import { authenticatedAdminEmail } from "./admin-access.js";
import { radioTranscripts } from "./admin-radio-transcripts.js";
import { associationEvidence } from "./admin-association-evidence.js";

const OLD_PRODUCTION_HOST =
  "afpd-tracker.ericseamonsdeveloper.workers.dev";

const WWW_HOST =
  "www.afpd-accountability.com";

const CANONICAL_ORIGIN =
  "https://afpd-accountability.com";

const GREENLAND_PROFILE_PATH = "/police-encounters/cody-wayne-greenland/";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      // Static Assets' router does not forward ctx.access to this Worker.
      // Validate Access's signed token, including its audience for this hostname.
      const adminEmail = await authenticatedAdminEmail(request, url);
      if (adminEmail !== "ericseamonsdeveloper@gmail.com") {
        return new Response("Access required", { status: 403 });
      }
      if (url.pathname === "/admin") {
        return Response.redirect(new URL("/admin/", url), 302);
      }
      const isVersionPreview = url.hostname.endsWith("-afpd-tracker.ericseamonsdeveloper.workers.dev");
      const database = isVersionPreview ? env.AFPD_DB_STAGING : env.AFPD_DB;
      if (url.pathname === "/admin/api/association-evidence") {
        return associationEvidence(request, url, database, adminEmail);
      }
      if (url.pathname === "/admin/api/radio-transcripts") {
        return radioTranscripts(request, url, database);
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
      }
      const adminResponse = await env.ASSETS.fetch(request);
      const protectedResponse = new Response(adminResponse.body, adminResponse);
      protectedResponse.headers.set("Cache-Control", "no-store");
      protectedResponse.headers.set("X-Robots-Tag", "noindex, nofollow");
      return protectedResponse;
    }

    const isOldGreenlandPath = /^\/(?:police-encounters\/)?(?:code|cody)-greenland\/?$/.test(url.pathname);
    const pathname = isOldGreenlandPath ? GREENLAND_PROFILE_PATH : url.pathname;

    if (
      url.hostname === OLD_PRODUCTION_HOST ||
      url.hostname === WWW_HOST
    ) {
      return Response.redirect(
        `${CANONICAL_ORIGIN}${pathname}${url.search}`,
        301
      );
    }

    if (isOldGreenlandPath) {
      url.pathname = pathname;
      return Response.redirect(url, 301);
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
    let response = await env.ASSETS.fetch(request);
    if (response.status === 404) {
      const object = await r2RadioAudio(request, env.RADIO_AUDIO) ??
        await r2OfficerPhoto(request, env.RADIO_AUDIO);
      if (object) response = object;
    }

    // Raw Law 2 recordings/transcripts remain accessible without search indexing.
    if (url.pathname.startsWith("/records/openmhz/openmhz-afpd-law-2-") ||
        url.pathname.startsWith("/records/openmhz/law-2-")) {
      response = new Response(response.body, response);
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
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
