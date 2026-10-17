function normalize(text) {
  return (String(text ?? "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(" ");
}

function forwardName(name) {
  const parts = String(name ?? "").split(",");
  return parts.length === 2 ? `${parts[1].trim()} ${parts[0].trim()}` : String(name ?? "");
}

function overviewText(section) {
  const text = [...(section.descriptions || [])];
  function visit(nodes) {
    for (const node of nodes || []) {
      if (node.type === "formatted-text") {
        text.push((node.segments || []).map(segment => segment.text || "").join(""));
      } else if (node.type === "text") {
        text.push(node.text_value || "");
      }
      if (typeof node.label === "string") text.push(node.label);
      if (node.contents) visit(node.contents);
    }
  }
  visit(section.contents);
  return text.map(value => ` ${normalize(value)} `);
}

export function profileAlternateNames(profile) {
  const names = (profile.alternate_names || []).map(name => typeof name === "string" ? name : name.name).filter(Boolean);
  const header = normalize(forwardName(profile.display_name || profile.name));
  const knownNames = [...new Set([header, normalize(forwardName(profile.name)), ...names.map(normalize)])];
  const text = (profile.sections || [])
    .filter(section => section.title === "Overview" && section.published !== false)
    .flatMap(overviewText);
  const seen = new Set();
  return names.filter(name => {
    const normalized = normalize(name);
    if (normalized === header || seen.has(normalized)) return false;
    seen.add(normalized);
    // A name embedded in a longer identity is not a separate use of its shorter form.
    const longerNames = knownNames.filter(other => other !== normalized && ` ${other} `.includes(` ${normalized} `))
      .sort((a, b) => b.length - a.length);
    return !text.some(paragraph => {
      let remaining = paragraph;
      for (const longer of longerNames) remaining = remaining.split(` ${longer} `).join(" [name] ");
      return remaining.includes(` ${normalized} `);
    });
  });
}
