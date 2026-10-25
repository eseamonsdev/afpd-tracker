// Serve only archived radio audio; other bucket keys remain inaccessible here.
export async function r2RadioAudio(request, bucket) {
  const path = new URL(request.url).pathname;
  if (!bucket || !/^\/records\/openmhz\/openmhz-afpd-(?:car-to-car|law-2|6036)-\d{4}-\d{2}-\d{2}\/dcfems-\d+-\d+\.m4a$/.test(path)) return null;
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, {status: 405, headers: {Allow: "GET, HEAD"}});
  const key = path.slice(1);
  const metadata = await bucket.head(key);
  if (!metadata) return null;
  const headers = new Headers();
  metadata.writeHttpMetadata(headers);
  headers.set("Content-Type", "audio/mp4");
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", metadata.httpEtag);
  headers.set("Cache-Control", "public, max-age=86400");
  if (request.headers.get("If-None-Match")?.split(/\s*,\s*/).some(value => value === metadata.httpEtag || value === "*")) {
    return new Response(null, {status: 304, headers});
  }
  let range;
  // If-Range mismatch requires the entire object. Multiple ranges may be ignored.
  const ifRange = request.headers.get("If-Range");
  const value = !ifRange || ifRange === metadata.httpEtag ? request.headers.get("Range") : null;
  const match = value?.match(/^bytes=(\d*)-(\d*)$/);
  if (request.method === "GET" && match && (match[1] || match[2])) {
    const offset = match[1] ? Number(match[1]) : Math.max(0, metadata.size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), metadata.size - 1) : metadata.size - 1;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset >= metadata.size || end < offset || (!match[1] && Number(match[2]) === 0)) {
      headers.set("Content-Range", `bytes */${metadata.size}`);
      return new Response(null, {status: 416, headers});
    }
    range = {offset, length: end - offset + 1};
    headers.set("Content-Range", `bytes ${offset}-${end}/${metadata.size}`);
  }
  headers.set("Content-Length", String(range?.length ?? metadata.size));
  if (request.method === "HEAD") return new Response(null, {headers});
  const object = await bucket.get(key, range ? {range} : undefined);
  if (!object) return null;
  return new Response(object.body, {status: range ? 206 : 200, headers});
}
