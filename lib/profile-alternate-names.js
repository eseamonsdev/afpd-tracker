function normalize(text) {
  return (String(text ?? "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(" ");
}

export function forwardName(name) {
  const parts = String(name ?? "").split(",");
  return parts.length === 2 ? `${parts[1].trim()} ${parts[0].trim()}` : String(name ?? "");
}

export function profileDisplayName(profile) {
  return forwardName(profile.display_name || profile.name);
}

export function profileAlternateNames(profile) {
  const names = (profile.alternate_names || []).map(name => typeof name === "string" ? name : name.name).filter(Boolean);
  const header = normalize(profileDisplayName(profile));
  return names.filter(name => normalize(name) !== header);
}
