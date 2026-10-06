function revealTargetDiscussion() {
  if (!window.location.hash) {
    return;
  }

  const target = document.getElementById(window.location.hash.slice(1));

  if (!target) {
    return;
  }

  let current = target;

  while (current) {
    if (current instanceof HTMLDetailsElement) {
      current.open = true;
    }

    current = current.parentElement;
  }

  target.scrollIntoView({ block: "start" });
}

window.addEventListener("hashchange", revealTargetDiscussion);
revealTargetDiscussion();
