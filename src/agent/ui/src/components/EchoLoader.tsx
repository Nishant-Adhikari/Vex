import { type FC, useEffect, useState } from "react";
import { cn } from "../utils";

const ECHO_PHRASES = [
  "every action echoes...",
  "echo locked on target...",
  "wings in motion...",
  "tracing the signal...",
  "claws ready...",
  "navigating the dark...",
  "pulse detected...",
  "sonar sweeping...",
  "in the frequency...",
  "echo never sleeps...",
];

const BAT_FRAMES = ["/blue.png", "/lite.png", "/pink.png", "/purple.png", "/red.png"];

export const EchoLoader: FC<{ className?: string }> = ({ className }) => {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [text, setText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [frameIdx, setFrameIdx] = useState(0);

  // Color-cycle bat every 2 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIdx(i => (i + 1) % BAT_FRAMES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Typewriter effect
  useEffect(() => {
    const currentPhrase = ECHO_PHRASES[phraseIndex];
    const typingSpeed = isDeleting ? 30 : 50;
    const pauseDelay = isDeleting ? 500 : 2000;

    let timer: ReturnType<typeof setTimeout>;

    if (!isDeleting && text === currentPhrase) {
      timer = setTimeout(() => setIsDeleting(true), pauseDelay);
    } else if (isDeleting && text === "") {
      setIsDeleting(false);
      setPhraseIndex((prev) => (prev + 1) % ECHO_PHRASES.length);
    } else {
      timer = setTimeout(() => {
        setText(currentPhrase.substring(0, text.length + (isDeleting ? -1 : 1)));
      }, typingSpeed);
    }

    return () => clearTimeout(timer);
  }, [text, isDeleting, phraseIndex]);

  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 py-4 select-none", className)}>
      {/* Vortex Logo — cycles through bat color variants */}
      <div className="relative flex items-center justify-center w-16 h-16">
        <div className="absolute inset-0 bg-accent/20 blur-xl rounded-full animate-pulse" />
        <img
          src={BAT_FRAMES[frameIdx]}
          alt="Echo Loading"
          className="w-12 h-12 object-contain relative z-10 animate-vortex drop-shadow-[0_0_8px_rgba(var(--accent),0.8)] transition-opacity duration-500"
          draggable={false}
        />
      </div>

      {/* Typewriter Text */}
      <div className="flex items-center gap-[1px] h-6 font-mono text-xs tracking-wider text-accent/90">
        <span>{text}</span>
        <span className="w-1.5 h-3.5 bg-accent/80 animate-blink" />
      </div>
    </div>
  );
};
