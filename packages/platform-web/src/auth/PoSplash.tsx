import { useEffect, useState } from "react";
import { NexoraMark } from "@nexora/ui";

/**
 * The Platform Owner console's opening experience.
 *
 * WHY IT IS AN OVERLAY AND NOT A ROUTE
 * The console underneath is already mounted and already resolving its session.
 * The splash is painted on top of it and then dismissed, which means it can
 * never block authentication, never cause a routing loop, never swallow a deep
 * link, and never hide an expired session - when it clears, the sign-in screen
 * is simply there. It renders at most once per browser session.
 *
 * WHO IT IS FOR
 * This is the SOFTWARE OWNER's entry, not a company's. It carries the Nexora
 * identity and nothing of a tenant: no company name, no company logo, no
 * company colour, and no "Company login" choice. A company employee never
 * reaches this console, so nothing here should read as if they might.
 *
 * ACCESSIBILITY
 * The overlay is aria-hidden and carries no focusable content, so assistive
 * technology never lands inside it. It is skipped entirely under
 * prefers-reduced-motion, and any key or pointer press dismisses it early.
 */

const SEEN_KEY = "nexora.po.splash.seen";
const FIRST_TIME_KEY = "nexora.po.splash.firstTime";
/** Long enough to read the line, short enough never to be a wait. */
const DWELL_MS = 1500;
const EXIT_MS = 420;

interface Phase {
  visible: boolean;
  leaving: boolean;
  firstTime: boolean;
}

function initialPhase(): Phase {
  // Anything that can throw here (private mode, blocked storage) must not break
  // the console, so the splash simply does not appear.
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return { visible: false, leaving: false, firstTime: false };
    }
    if (window.sessionStorage.getItem(SEEN_KEY) === "1") {
      return { visible: false, leaving: false, firstTime: false };
    }
    const firstTime = window.localStorage.getItem(FIRST_TIME_KEY) !== "1";
    return { visible: true, leaving: false, firstTime };
  } catch {
    return { visible: false, leaving: false, firstTime: false };
  }
}

export function PoSplash() {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const visible = phase.visible;

  useEffect(() => {
    if (!visible) return;

    const mark = () => {
      try {
        window.sessionStorage.setItem(SEEN_KEY, "1");
        window.localStorage.setItem(FIRST_TIME_KEY, "1");
      } catch {
        /* storage unavailable - the splash simply replays next load */
      }
    };

    const leave = () => {
      mark();
      setPhase((p) => (p.leaving ? p : { ...p, leaving: true }));
    };

    // Reads as a brand beat, never as a wait: it clears itself, and any key or
    // pointer press clears it sooner.
    const auto = window.setTimeout(leave, DWELL_MS);

    const onKey = () => {
      window.clearTimeout(auto);
      leave();
    };

    window.addEventListener("keydown", onKey, { once: true });
    window.addEventListener("pointerdown", onKey, { once: true });

    return () => {
      window.clearTimeout(auto);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onKey);
    };
  }, [visible]);

  // Unmount only after the exit transition has actually played, so the fade is
  // seen rather than skipped.
  useEffect(() => {
    if (!visible || !phase.leaving) return;
    const t = window.setTimeout(() => setPhase((p) => ({ ...p, visible: false })), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [visible, phase.leaving]);

  if (!visible) return null;

  return (
    <div className="nxp-splash" data-leaving={phase.leaving ? "true" : "false"} aria-hidden="true">
      <span className="nx-brand__grid" />
      <span className="nxp-splash__bg nxp-splash__bg--a" />
      <span className="nxp-splash__bg nxp-splash__bg--b" />

      <div className="nxp-splash__inner">
        <div className="nxp-splash__identity nx-reveal" style={{ transitionDelay: "0ms" }}>
          <NexoraMark size={44} />
          <div>
            <div className="nxp-splash__name">Nexora</div>
            <div className="nxp-splash__kicker">Platform Owner console</div>
          </div>
        </div>

        <div className="nxp-splash__copy">
          <p className="nx-brand__eyebrow nx-reveal" style={{ transitionDelay: "70ms" }}>
            {phase.firstTime ? "Welcome" : "Welcome back"}
          </p>
          <h1 className="nx-brand__title nx-reveal" style={{ transitionDelay: "140ms" }}>
            {phase.firstTime ? "The factory floor for every Nexora company." : "Your console is ready."}
          </h1>
          {phase.firstTime && (
            <p className="nx-brand__lede nx-brand__muted nx-reveal" style={{ transitionDelay: "210ms" }}>
              Create companies, hand over MD credentials, watch platform health and open time-bound
              support access &mdash; every action append-only audited.
            </p>
          )}
        </div>

        <div className="nxp-splash__rule nx-reveal" style={{ transitionDelay: "280ms" }}>
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
