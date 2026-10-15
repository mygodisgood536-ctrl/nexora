# Nexora design system

The implemented visual identity. This file records what the product actually
uses, where each value came from, and which Vision rule constrains it — so a
future change is made against evidence rather than taste.

**Authority:** `docs/verification/VISION-v3.9-AUTHORITY.txt` (Vision v3.9),
verified against the source `.docx`.
**Enforced by:** `npm run verify:design`.

---

## 1. Where the identity comes from

The visual identity is adopted from the owner's reference site,
`cornelius-adedeji-victor-website.vercel.app`. Its design tokens and stylesheet
were extracted directly rather than eyeballed, and the values below are
transcribed from what was measured there.

One deliberate divergence has to be stated plainly.

**The reference site is dark-only** (`--bg: #070a12`). **Vision Part 13 requires
the opposite**, and is explicit:

| Vision rule | Required value |
|---|---|
| RULE 13.2 application background | "a soft off-white or light neutral" |
| RULE 13.2 card and container surfaces | "a clean white or very light neutral" |
| RULE 13.2 primary text | "a deep neutral charcoal or near-black" |
| RULE 13.2 secondary text and labels | "a mid neutral grey" |
| RULE 13.2 dividers, borders, table rules | "light neutral greys" |
| RULE 13.3.1 | everything read at length stays neutral, always |

The Vision is the single source of truth for the product, and it does not
admit a dark workspace. So the reference's identity is carried by its **design
language** — typography, scale, spacing rhythm, radii, depth strategy, component
forms and motion — rather than by its polarity. Going the other way, darkening
the workspace, would have contradicted six explicit rules.

Readability is raised above the reference rather than matched to it. Body text
here runs **17.0:1**; the reference's body runs roughly **9.4:1**. Both pass, but
this is the one that was asked for.

---

## 2. Typography

Three self-hosted variable faces, exactly as the reference uses them.

| Role | Face | Stack |
|---|---|---|
| Display | **Fraunces** (variable 100–900) | `"Fraunces Variable", Fraunces, ui-serif, Georgia, serif` |
| UI + body | **Inter** (variable 100–900) | `"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif` |
| Eyebrows, labels, figures | **JetBrains Mono** (variable 400–600) | `"JetBrains Mono Variable", ui-monospace, monospace` |

Poppins was the previous default and has been removed from every package.

### Display scale

Transcribed from the reference's own values:

| Token | Size | Line height | Tracking |
|---|---|---|---|
| `--nx-display-xl` | `clamp(2.1rem, 4.4vw, 3.1rem)` | 1.12 | −0.022em |
| `--nx-display-lg` | `clamp(1.7rem, 3.2vw, 2.35rem)` | 1.18 | −0.018em |
| `--nx-display-md` | `clamp(1.35rem, 2.3vw, 1.7rem)` | 1.28 | −0.012em |
| `--nx-display-sm` | `clamp(1.12rem, 1.7vw, 1.3rem)` | — | — |

### Micro-label

The reference's `.eyebrow`, used verbatim for every stat label, nav group title
and breadcrumb separator:

```css
font-family: var(--nx-font-mono);
font-size: 0.7rem;            /* 0.6875rem in dense contexts */
font-weight: 500;
letter-spacing: 0.24em;       /* 0.19em in dense contexts */
text-transform: uppercase;
```

---

## 3. The non-changeable layer (RULE 13.2)

Never branded, identical in every company and every role. Verified by
`npm run verify:design`.

| Token | Value | Contrast on its own surface |
|---|---|---|
| `--nx-bg-app` | `#f5f6f9` | — |
| `--nx-bg-app-deep` | `#edeff4` | — |
| `--nx-surface` | `#ffffff` | — |
| `--nx-surface-alt` | `#fafbfd` | — |
| `--nx-surface-sunken` | `#f1f3f7` | — |
| `--nx-text` | `#10141f` | **17.02:1** on `--nx-bg-app` |
| `--nx-text-secondary` | `#464f63` | **8.21:1** on `--nx-surface` |
| `--nx-text-muted` | `#616c82` | **5.28:1** on `--nx-surface` |
| `--nx-border` | `#e2e6ee` | — |
| `--nx-border-strong` | `#c9d0dd` | — |
| `--nx-divider` | `#edeff4` | — |

Semantic colours keep their own meaning in every company (RULE 13.2):
success `#0f6b45`, warning `#7a5300`, danger `#a81f16`, info `#14538f`. A
company that chooses red as its colour does not turn success messages red.

---

## 4. The accent layer (RULE 13.3)

Only these ever take a company's colour: the primary action button, the
secondary outline button, the active navigation item and its indicator, the
active tab underline, the focus ring, the input focus border, selected-state
controls, links, the progress indicator, the selected row tint, the logo and
site identity, the avatar ring, the header accent, the first chart series, the
badge and notification dot, empty-state accents, exported-document brand
elements, email brand blocks, customer-portal accents, and the mobile primary
action.

| Token | Default | Rule |
|---|---|---|
| `--nx-color-accent` | `#111111` | **RULE 13.4.1** — near-black charcoal before any company exists |
| `--nx-color-accent-strong` | `#000000` | hover / pressed |
| `--nx-color-accent-soft` | `#eeeeF0` | tinted fills |
| `--nx-color-on-accent` | `#ffffff` | **RULE 13.5.1** — computed, never chosen |
| `--nx-color-accent-ring` | `rgb(17 17 17 / 0.24)` | focus ring |
| `--nx-color-accent-tint` | `rgb(17 17 17 / 0.06)` | selected-row tint |

**RULE 13.4.2** — the Platform Owner console is green, scoped under `.nxp`
(`#0f7b4f`). It is never switched to a company colour, and a company workspace
is never shown green.

**RULE 13.5.2** — the branding screen warns without blocking when a chosen
colour would hurt legibility, and suggests a shade of the same colour that
passes contrast.

### The rest of the stored brand record

`themes` also carries `primary_color`, `secondary_color`, `navy_color` and
`font_family`. These are consumed **only on brand-identity surfaces** — the logo
tile, the sign-in brand panel, the splash — which is where RULE 13.1.1 permits a
brand colour. They are never a workspace background and never body text.

They are grammar-checked before they reach a custom property (RULE 13.8.1): a
colour must be strict `#RRGGBB`, and a font family must match
`FONT_FAMILY_RE`. A value that fails is dropped, leaving the stylesheet default
in force, so a stored value cannot close the declaration and append rules.

---

## 5. Shape, depth and layout

**Radii** — the reference family: `8px` (controls), `12px` (cards),
`16px` (panels, tables), `20px` (modals), `999px` (pills, buttons).

**Depth is ring-first.** The reference raises no drop shadows; it separates
surfaces with a 1px hairline plus a single inset top highlight. That is adopted.
Shadows exist only as a soft second layer:

```css
.nx-panel::before {           /* the reference's hairline-top */
  content: ""; position: absolute; inset-inline: 0; top: 0; height: 1px;
  background: linear-gradient(90deg, transparent, rgb(16 20 31 / 0.07), transparent);
}
```

**Container and rhythm** — `max-width: 1240px`; gutters `1.25rem` / `1.75rem`
(≥40em) / `2.5rem` (≥64em); section padding `64px` → `80px` → `96px`.

**The hairline grid** — the reference's signature. A line-coloured container with
`gap: 1px` and line-free children, so the gaps *are* the dividers. Used for the
landing summary (RULE 12.0.3) and for card groups. See `.nx-hairgrid`.

**Motion** — `140ms` for control feedback, `300ms` for layout, easing
`cubic-bezier(0.22, 1, 0.36, 1)` (the reference's). Reveal-on-load uses the
reference's 750ms opacity + 18px translate, staggered 55ms.

---

## 6. The brand surface

The reference's exact ink identity, available **only** to brand surfaces — the
splash, the sign-in brand panel, the wordmark tile:

| Token | Value |
|---|---|
| `--nx-ink` | `#070a12` |
| `--nx-ink-elevated` | `#0b1020` |
| `--nx-ink-surface` | `#101728` |
| `--nx-ink-line` | `#96a8cd` |
| `--nx-brand-accent` | `#7c9cff` |
| `--nx-brand-accent-bright` | `#a5bcff` |
| `--nx-brand-accent-ink` | `#0a1024` |
| `--nx-brand-teal` | `#5fd6c4` |
| `--nx-brand-fg` | `#f3f6fc` |
| `--nx-brand-fg-muted` | `#b0bccf` |
| `--nx-brand-fg-subtle` | `#8e9bb3` |

Logo tile: a 150° gradient through the company's own secondary and navy colours
with a radial highlight, `inset 0 0 0 1px rgb(255 255 255 / 0.16)`, radius 11px.
The Platform console swaps the blue highlight for teal so a screenshot of it is
never mistaken for a company workspace.

Glow orbs are `blur(90px)` radial gradients; the grid backdrop is a 64px
`rgba(150,168,205,0.07)` lattice masked with
`radial-gradient(120% 85% at 50% 0%, #000 35%, transparent 78%)`. These are
transcribed from the reference, not approximated.

---

## 7. Splash and welcome

Painted **over** the already-mounted app, never in front of a route.

This is a structural choice with a purpose. Because the application underneath
is already mounted and already resolving its session:

- it cannot block authentication — nothing waits on it;
- it cannot cause a routing loop — it holds no route;
- a deep link still resolves, and a session that expires mid-splash still lands
  on the sign-in screen when the splash clears;
- it runs at most once per browser session.

`aria-hidden`, no focusable content, dismissed by any key or pointer press, and
**skipped entirely under `prefers-reduced-motion`**. Storage failures are
swallowed so a blocked `sessionStorage` cannot break the app.

---

## 8. Rules that cannot be broken

- **RULE 13.1.1** — the company colour is a highlighter, never a background wash.
- **RULE 13.1.2 / 13.2** — surfaces, text and dividers never change.
- **RULE 13.3.1** — nothing read at length is ever the company colour.
- **RULE 13.4.3 / 13.8.1** — no component contains a company colour; every themed
  value comes from the theme record and is grammar-checked.
- **RULE 13.5.3** — colour never replaces meaning; a status is a status because
  of its words and icon.
- **RULE 13.6.1 / 13.6.2** — the logo appears on the login screen and everywhere
  it is named; a company without one shows its name in a styled placeholder,
  never a broken image.
- **RULE 13.7.1** — every screen a company's users see carries the company's
  name, not the platform's.

---

## 9. Checks

```bash
npm run verify:design
```

Asserts, and fails the build on any regression:

1. every referenced `--nx-*` token is defined (81 tokens);
2. every token the server sets is consumed by the stylesheet;
3. RULE 13.4.1 / 13.4.2 accent defaults and the shared `DEFAULT_ACCENT` agree;
4. the neutral layer is light and neutral;
5. **WCAG contrast** for thirteen foreground/background pairs, minimum 4.5:1;
6. the reference identity is present and Poppins is gone;
7. the brand surface is contained;
8. every `nx-*` class used in markup has a rule (178 classes).