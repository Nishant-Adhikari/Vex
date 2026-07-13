const states = {
  idle: { row: 0, frames: 6, ms: 480, label: "Vexa is ready", detail: "Watching VEX locally" },
  waiting_approval: { row: 6, frames: 6, ms: 260, label: "Approval needed", detail: "Open VEX to review" },
  running: { row: 7, frames: 6, ms: 150, label: "Mission running", detail: "Watching execution locally" },
  scheduled: { row: 0, frames: 6, ms: 720, label: "Scheduled", detail: "Next run in 42m" },
  success: { row: 8, frames: 6, ms: 240, label: "Mission profitable", detail: "Mission #42 · +4.25%" },
  failed: { row: 5, frames: 8, ms: 260, label: "Mission needs attention", detail: "Open VEX to inspect" },
  offline: { row: 0, frames: 1, ms: 1000, label: "VEX offline", detail: "Vexa hides until VEX starts" },
};

let currentState = "running";
let frame = 0;
let animationTimer;

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

function selectState(name) {
  if (!states[name]) return;
  currentState = name;
  frame = 0;
  const state = states[name];
  clearInterval(animationTimer);
  paint();
  animationTimer = setInterval(paint, state.ms);

  labels.forEach((node) => { node.textContent = state.label; });
  details.forEach((node) => { node.textContent = state.detail; });
  document.querySelectorAll(".state-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.state === name);
  });
  demoStage?.setAttribute("data-state", name);
  document.body.dataset.state = name;
}

document.querySelectorAll(".state-button").forEach((button) => {
  button.addEventListener("click", () => selectState(button.dataset.state));
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add("visible");
  });
}, { threshold: 0.12 });

document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
selectState("running");
