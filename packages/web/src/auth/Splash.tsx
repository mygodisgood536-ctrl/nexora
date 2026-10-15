import { useEffect, useState } from "react";
import { companyLogo, companyName } from "../lib/theme";

/**
 * Nexora brand splash and welcome.
 *
 * WHY IT IS AN OVERLAY AND NOT A ROUTE
 * The application underneath is already mounted and already resolving its
 * session. The splash is painted on top of it and then dismissed. That is a
 * deliberate structural choice, not a shortcut:
 *
 *   - it can never block authentication, because nothing waits on it;
 *   - it can never cause a routing loop, because it holds no route;
 *   - a deep link still resolves, and a session that expires mid-splash still
 *     lands on the sign-in screen when the splash clears;
 *   - it renders at most once per browser session, so it never gets in the way
 *     of someone working.
 *
 * ACCESSIBILITY
 * The overlay is aria-hidden and carries no focusable content, so assistive
 * technology never lands inside it. It is skipped entirely under
 * prefers-reduced-motion, and any key or pointer press dismisses it early.
 */

const SEEN_KEY = "nexora.splash.seen";
const FIRST_TIME_KEY = "nexora.splash.firstTime";
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
  // the app, so the splash simply does not appear.
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

export function Splash() {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const company = companyName();
  const logo = companyLogo();

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
    <div
      className="nxs nx-brand"
      data-leaving={phase.leaving ? "true" : "false"}
      aria-hidden="true"
    >
      <span className="nx-brand__grid" />
      <span className="nxs__orb nxs__orb--accent" />
      <span className="nxs__orb nxs__orb--teal" />

      <div className="nxs__inner">
        <div className="nxs__identity nx-reveal" style={{ transitionDelay: "0ms" }}>
          <span className="nx-mark" style={{ width: 46, height: 46, fontSize: "0.95rem" }}>
            {/* RULE 13.6.2 - the name placeholder stands in when the company
                has not uploaded a logo, never a broken image. */}
            {logo ? <img src={logo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : "NX"}
          </span>
          <div>
            <div style={{ fontFamily: "var(--nx-font-display)", fontSize: "1.02rem", fontWeight: 600, letterSpacing: "-0.01em", color: "#fff" }}>
              {company}
            </div>
            <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: "0.6rem", letterSpacing: "0.19em", textTransform: "uppercase", color: "var(--nx-brand-fg-subtle)" }}>
              Microfinance operating system
            </div>
          </div>
        </div>

        <div className="nxs__copy">
          <p className="nx-brand__eyebrow nx-reveal" style={{ transitionDelay: "70ms" }}>
            {phase.firstTime ? "Welcome" : "Welcome back"}
          </p>
          <h1 className="nx-brand__title nx-reveal" style={{ transitionDelay: "140ms" }}>
            {phase.firstTime ? "Every loan, payment and ledger entry in one truthful place." : "Your workspace is ready."}
          </h1>
          {phase.firstTime && (
            <p className="nx-brand__lede nx-brand__muted nx-reveal" style={{ transitionDelay: "210ms" }}>
              Financial truth survives failure: records, evidence and audit history are protected,
              recoverable and never destructively deleted.
            </p>
          )}
        </div>

        {/* The reference's hairline rule. */}
        <div className="nxs__rule nx-reveal" style={{ transitionDelay: "280ms" }}>
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}