# EXPADIO Design Guide

**Version:** 1.0  
**Status:** Canonical  
**Applies to:** All Brand Workspaces, Platform surfaces, and modules  

This guide ensures visual and interaction consistency across the entire EXPADIO platform while allowing each Brand to express its own identity through **semantic color tokens**.

---

## 1. Core Philosophy

EXPADIO is a **governed control plane**.  

Every interface decision must serve:

- Clarity of current state
- Speed of next action
- Trust and precision
- Performance (prefer compositor-only motion)

**Principles**

1. **Brand color is the only variable** — Primary, Secondary, and Accent are chosen by the Brand. Everything else is standardized.
2. **Clarity over decoration**
3. **One primary action per context**
4. **Restraint in motion**
5. **Consistent spacing and density**
6. **Accessible by default**

---

## 2. Color System (Brand-Driven)

Colors must **never be hard-coded** in components.  
All color usage must reference semantic tokens that resolve from the Brand’s Appearance settings.

### 2.1 Brand Identity Tokens (Editable by Brand)

These are set in **Brand Administration → Appearance**:

| Token              | Purpose                                      | Example (Dreamware) |
|--------------------|----------------------------------------------|---------------------|
| `--brand-primary`  | Main brand color (buttons, active states)    | `#FACC15` (Yellow)  |
| `--brand-secondary`| Supporting brand color                       | `#A855F7` (Purple)  |
| `--brand-accent`   | Highlight / secondary emphasis               | `#22D3EE` (Cyan)    |
| `--brand-name`     | Display name                                 | `DREAMWARE`         |

### 2.2 Semantic Platform Tokens (Standard – Do Not Change)

These remain consistent across all brands:

```css
/* Backgrounds */
--background: #000000;
--foreground: #FAFAFA;
--card: #0A0A0A;
--card-foreground: #FAFAFA;
--popover: #0A0A0A;
--popover-foreground: #FAFAFA;

/* Muted / Borders */
--muted: #171717;
--muted-foreground: #A1A1AA;
--border: #272727;
--input: #272727;
--ring: var(--brand-primary);          /* Focus ring uses brand primary */

/* Semantic status (fixed) */
--success: #22C55E;
--warning: #F59E0B;
--destructive: #EF4444;
--info: #3B82F6;

/* Sidebar */
--sidebar: #0A0A0A;
--sidebar-foreground: #FAFAFA;
--sidebar-border: #1F1F1F;
```

### 2.3 Usage Rules

| Element                    | Token to use                  |
|---------------------------|-------------------------------|
| Primary button background | `--brand-primary`             |
| Primary button text       | Calculated contrast (usually black or white) |
| Active tab / selected     | `--brand-primary`             |
| Focus rings               | `--brand-primary`             |
| Links / highlights        | `--brand-accent` or `--brand-primary` |
| Secondary buttons         | `--secondary` + border        |
| Success states            | `--success`                   |
| Destructive actions       | `--destructive`               |
| Cards / surfaces          | `--card` / `--background`     |

**Never** hard-code hex values for brand colors in components.

---

## 3. Typography

**Font families (standard)**

- Sans: `Inter`, `Geist`, system-ui, sans-serif
- Mono: `JetBrains Mono`, `SF Mono`, ui-monospace, monospace

**Scale**

| Token            | Size   | Usage                        |
|------------------|--------|------------------------------|
| `--font-xs`      | 11px   | Labels, badges               |
| `--font-sm`      | 12px   | Secondary text, meta         |
| `--font-base`    | 13px   | Body                         |
| `--font-md`      | 14px   | Body emphasis                |
| `--font-lg`      | 16px   | Section titles               |
| `--font-xl`      | 18px   | Card titles                  |
| `--font-2xl`     | 20px   | Page section headers         |
| `--font-3xl`     | 24px   | Page titles                  |
| `--font-4xl`     | 30px   | Large headers                |
| `--font-display` | 36–48px| Hero / marketing only        |

**Weights**

- Regular: 400
- Medium: 500
- Semibold: 600
- Bold: 700

**Rules**
- Page titles: Semibold or Bold
- Section headers: Semibold
- Body: Regular
- Labels / meta: Medium or Regular, muted color
- Monospace only for IDs, codes, topology labels, technical values

---

## 4. Spacing System

**Base unit: 4px**

| Token     | Value | Common usage                          |
|-----------|-------|---------------------------------------|
| space-1   | 4px   | Icon + text gap                       |
| space-2   | 8px   | Tight related elements                |
| space-3   | 12px  | Form field groups                     |
| space-4   | 16px  | Default card padding, button padding  |
| space-5   | 20px  | Comfortable internal spacing          |
| space-6   | 24px  | Between cards / blocks                |
| space-8   | 32px  | Between sections                      |
| space-10  | 40px  | Major vertical rhythm                 |
| space-12  | 48px  | Large section breaks                  |

**Specific rules**
- Minimum padding inside cards: `16px`
- Gap between buttons in a group: `8–12px`
- Vertical gap between form fields: `16–20px`
- Space above a section header: `24–32px`
- Text must never sit closer than `12px` to a border or interactive edge

---

## 5. Radius (Sharp Standard)

EXPADIO uses **sharp, precise corners**.

| Token          | Value  | Usage                              |
|----------------|--------|------------------------------------|
| `--radius-sm`  | 2px    | Small chips, tight elements        |
| `--radius-md`  | 4px    | Buttons, inputs, small controls    |
| `--radius-lg`  | 6px    | Cards, panels                      |
| `--radius-xl`  | 8px    | Modals, large containers           |
| `--radius-2xl` | 12px   | Rare – only special feature panels |
| `--radius-full`| 9999px | Avatars, pills, status dots only   |

**Do not** use large rounded corners (16px+) on standard UI.

---

## 6. Borders & Elevation

- Default border: `1px solid var(--border)`
- Strong border: `1.5px` (rare)
- Focus ring: `2px` solid `var(--brand-primary)` with optional soft glow
- Shadows: Prefer borders over heavy shadows. Use only subtle elevation when needed.

```css
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.6);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.5);
--shadow-glow: 0 0 20px color-mix(in srgb, var(--brand-primary) 25%, transparent);
```

---

## 7. Buttons

**Hierarchy**

| Type        | Style                                      | When to use                          |
|-------------|--------------------------------------------|--------------------------------------|
| Primary     | `background: var(--brand-primary)`         | The single main action on a view     |
| Secondary   | Dark surface + 1px border                  | Supporting actions                   |
| Tertiary    | Ghost / text only                          | Low emphasis                         |
| Destructive | `background: var(--destructive)`           | Irreversible actions (with confirm)  |

**Specifications**
- Height: 36px default · 32px compact · 40px prominent
- Padding: `0 16px`
- Radius: `4px`
- Font: Medium (500)

**Rules**
- Only **one** primary button per logical section.
- Primary button text color must maintain contrast (usually black on light primary, white on dark primary).
- Loading state: show spinner and keep or replace label.

---

## 8. Cards & Boxes

- Background: `var(--card)`
- Border: `1px solid var(--border)`
- Radius: `6px`
- Padding: `16px` minimum

**Variants**
- **Static** — information only
- **Interactive** — hover state + pointer (used for navigation cards)
- **Selected** — border or left accent using `var(--brand-primary)`
- **Empty** — centered message + primary action

---

## 9. Controls: When to Use What

| Control            | Preferred for                              | Avoid for                     |
|--------------------|--------------------------------------------|-------------------------------|
| Segmented control  | Stage filters, view toggles                | Long lists                    |
| Tabs               | Module-level navigation                    | Filtering large datasets      |
| Select / Combobox  | Long option lists                          | Binary choices                |
| Toggle             | Binary settings                            | Multi-state                   |
| Slider             | Continuous numeric ranges only             | Discrete stages or choices    |
| Stepper            | Small integer adjustments                  | Large ranges                  |

**Sliders** should be rare. Prefer number inputs for precision.

---

## 10. Motion

Motion follows the **Motion.dev performance philosophy**.

**Preferred properties (S-Tier)**
- `transform`
- `opacity`
- `filter` (use sparingly)
- `clip-path`

**Standard presets** (from Motion UI style)

```ts
transitions: {
  snap:    { stiffness: 1218, damping: 70 },
  ui:      { stiffness: 305,  damping: 33 },  // default
  gentle:  { stiffness: 110,  damping: 20 },
  lively:  { stiffness: 622,  damping: 17 },
  ambient: { stiffness: 43,   damping: 13 },
}
```

**Rules**
- Default transition for UI: `ui`
- Hover micro-interactions: short + `snap` or `ui`
- Page / section enters: `gentle`
- Live status indicators: `lively` or ambient pulse
- Always respect `prefers-reduced-motion`

---

## 11. Analytics & Metrics Placement

Every primary view should surface **state + attention**.

**Rules**
- Place key metrics at the top of the content area or in a summary bar.
- Limit to 3–5 primary metrics.
- Metrics should be actionable (click → filter or navigate).
- Zero states must still reserve the metric layout.
- Use consistent visual treatment: large number + label + optional trend.

**Examples**
- Lead Management Overview → stage counts + needs-attention
- Inbox → filtered count + average time in stage
- Topology → open items + health + latency
- Agent Missions → active / success rate / failed

---

## 12. Form & Modal Patterns

- Prefer **slide-overs** or **modals** for Create / Edit flows instead of full-page navigation.
- Keep the user in context.
- Group fields logically with clear section headers.
- Required fields marked clearly.
- Primary action at the bottom right of the form (or sticky footer in slide-over).

---

## 13. Empty States

Every empty view must:
1. Explain why it is empty
2. Offer the next logical action (usually a primary button)
3. Maintain layout structure so the page does not jump when data appears

---

## 14. Accessibility

- Maintain WCAG AA contrast minimum
- Full keyboard navigation support
- Visible focus rings using `var(--brand-primary)`
- Respect `prefers-reduced-motion`
- Do not rely on color alone to convey state

---

## 15. Implementation Checklist

Before shipping any new view or component:

- [ ] All colors reference semantic tokens (no hard-coded brand hex)
- [ ] Primary action uses `--brand-primary`
- [ ] Only one primary button in the main context
- [ ] Spacing follows the 4px grid
- [ ] Radius is 4px (controls) or 6px (cards)
- [ ] Motion stays on transform / opacity where possible
- [ ] Metrics are limited and actionable
- [ ] Empty state is helpful
- [ ] Focus states are visible
- [ ] Works in both Light and Dark (if supported) via tokens

---

## 16. Token Reference (Quick Copy)

```css
:root {
  /* Brand – injected from Appearance settings */
  --brand-primary: #FACC15;
  --brand-secondary: #A855F7;
  --brand-accent: #22D3EE;

  /* Platform – standard */
  --background: #000000;
  --foreground: #FAFAFA;
  --card: #0A0A0A;
  --border: #272727;
  --muted-foreground: #A1A1AA;
  --success: #22C55E;
  --warning: #F59E0B;
  --destructive: #EF4444;

  /* Radius */
  --radius-md: 4px;
  --radius-lg: 6px;

  /* Spacing base */
  --space-unit: 4px;
}
```

---

**This guide is the single source of truth for visual and interaction consistency across EXPADIO.**  
Brand identity changes flow only through the Appearance settings. All other rules remain fixed.

*Last updated: 2026-09-06*
