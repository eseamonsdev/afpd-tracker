// Expose only named officer portraits and generated thumbnails.
export async function r2OfficerPhoto(request, bucket) {
  const path = new URL(request.url).pathname;
  const thumbnail = /^\/officer-photos\/thumbnails\/[a-z0-9]+(?:-[a-z0-9]+)*-thumbnail\.webp$/.test(path);
  const portrait = /^\/officer-photos\/[a-z0-9]+(?:-[a-z0-9]+)*-photo\.(?:jpe?g|png|webp)$/.test(path);
  if (!bucket || !(thumbnail || portrait)) return null;
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, {status: 405, headers: {Allow: "GET, HEAD"}});
  const object = await bucket.get(path.slice(1));
  if (!object) return null;
  const headers = new Headers({
    "Content-Type": thumbnail ? "image/webp" : path.endsWith('.png') ? "image/png" : path.endsWith('.webp') ? "image/webp" : "image/jpeg",
    "Content-Length": String(object.size),
    "Cache-Control": "public, max-age=86400",
    "ETag": object.httpEtag
  });
  return new Response(request.method === "HEAD" ? null : object.body, {headers});
}
