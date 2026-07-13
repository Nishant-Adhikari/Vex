// Each state maps to a spritesheet row (cells are 192×208). `ms` is the
// per-frame cadence; `hold` is how long the stage lingers before the auto-tour
// advances to the next state.
const states = {
  idle: { row: 0, frames: 6, ms: 480, hold: 2400, label: "Vexa is ready", detail: "Watching VEX locally" },
  running: { row: 7, frames: 6, ms: 150, hold: 2600, label: "Mission running", detail: "Watching execution locally" },
  waiting_approval: { row: 6, frames: 6, ms: 260, hold: 2600, label: "Approval needed", detail: "Open VEX to review" },
  scheduled: { row: 0, frames: 6, ms: 720, hold: 2400, label: "Scheduled", detail: "Next run in 42m" },
  // Row 9 is the money shot — Vexa picks the token from her mouth and flips it.
  success: { row: 9, frames: 7, ms: 150, hold: 3400, label: "Mission profitable", detail: "Mission #42 · +4.25%" },
  failed: { row: 5, frames: 8, ms: 260, hold: 2600, label: "Mission needs attention", detail: "Open VEX to inspect" },
  offline: { row: 0, frames: 1, ms: 1000, hold: 2000, label: "VEX offline", detail: "Vexa hides until VEX starts" },
};

// The auto-tour order (mirrors the 01–07 state buttons).
const tour = ["idle", "running", "waiting_approval", "scheduled", "success", "failed", "offline"];

const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

let currentState = "idle";
let frame = 0;
let animationTimer;
let tourTimer;
let autoTour = !reduceMotion;

const sprites = [...document.querySelectorAll("[data-state-sprite]")];
const labels = [...document.querySelectorAll("[data-live-label]")];
const details = [...document.querySelectorAll("[data-live-detail]")];
const demoStage = document.querySelector("[data-demo-stage]");

function paint() {
  const state = states[currentState];
  for (const sprite of sprites) {
    sprite.style.backgroundPosition = `${-(frame % state.frames) * 192}px ${-state.row * 208}px`;
  }
  frame += 1;
}

function scheduleNextTour() {
  clearTimeout(tourTimer);
  if (!autoTour) return;
  tourTimer = setTimeout(() => {
    const i = tour.indexOf(currentState);
    const next = tour[(i + 1) % tour.length];
    selectState(next, { auto: true });
  }, states[currentState].hold);
}

// `auto:true` = advanced by the tour; a plain call (button click) pins the
// state and stops the tour so the visitor can inspect it.
function selectState(name, { auto = false } = {}) {
  if (!states[name]) return;
  if (!auto) {
    autoTour = false;
    clearTimeout(tourTimer);
  }
  currentState = name;
  frame = 0;
  const state = states[name];
  clearInterval(animationTimer);
  paint();
  if (!reduceMotion && state.frames > 1) {
    animationTimer = setInterval(paint, state.ms);
  }

  labels.forEach((node) => { node.textContent = state.label; });
  details.forEach((node) => { node.textContent = state.detail; });
  document.querySelectorAll(".state-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.state === name);
  });
  demoStage?.setAttribute("data-state", name);
  document.body.dataset.state = name;

  scheduleNextTour();
}

document.querySelectorAll(".state-button").forEach((button) => {
  button.addEventListener("click", () => selectState(button.dataset.state));
});

// Pause the tour while the tab is hidden so it doesn't churn in the background.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTimeout(tourTimer);
    clearInterval(animationTimer);
  } else {
    if (!reduceMotion && states[currentState].frames > 1) {
      animationTimer = setInterval(paint, states[currentState].ms);
    }
    scheduleNextTour();
  }
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add("visible");
  });
}, { threshold: 0.12 });

document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));

selectState("idle", { auto: true });
