// Expose generated officer thumbnails through the site's own origin.
export async function r2OfficerThumbnail(request, bucket) {
  const path = new URL(request.url).pathname;
  if (!bucket || !/^\/officer-photos\/thumbnails\/[a-z0-9]+(?:-[a-z0-9]+)*-thumbnail\.webp$/.test(path)) return null;
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, {status: 405, headers: {Allow: "GET, HEAD"}});
  const object = await bucket.get(path.slice(1));
  if (!object) return null;
  const headers = new Headers({
    "Content-Type": "image/webp",
    "Content-Length": String(object.size),
    "Cache-Control": "public, max-age=86400",
    "ETag": object.httpEtag
  });
  return new Response(request.method === "HEAD" ? null : object.body, {headers});
}
