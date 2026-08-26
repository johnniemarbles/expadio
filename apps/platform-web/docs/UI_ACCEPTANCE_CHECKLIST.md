# Platform UI acceptance checklist

Use this checklist for fixture demonstrations and again when live adapters are connected.

## Automated gate

- TypeScript passes without emit.
- Fixture contract tests pass.
- The production Next.js build completes.
- Platform Web and Core Spine checks are green on the current PR head.

## Primary demo flow

1. Open Overview and confirm the fixture banner is visible.
2. Change the organization and confirm the selection survives navigation.
3. Switch fixture accounts and confirm the organization falls back to an allowed scope.
4. Visit Capabilities, Governance, Audit, and every Company Brain tab.
5. Confirm loading, empty, denied, and error states use product language and do not expose internal errors.
6. Confirm health, notifications, authentication, and freshness never imply a live connection.

## Interaction acceptance

- Mobile navigation opens, traps keyboard focus, closes with Escape or the overlay, and returns focus to the menu button.
- Account and notification popovers close with Escape, outside click, route change, or another popover opening.
- All interactive controls have visible focus, accessible names, and at least a 44-pixel touch target.
- Organization and account context remain encoded in navigation URLs.
- Reduced-motion preferences disable pulsing and transitions.

## Responsive acceptance

Check representative widths at 375, 768, 1024, and 1440 pixels.

- No horizontal page overflow.
- The mobile top bar retains the menu, organization picker, and notification control.
- Secondary fixture-source context may collapse on small screens.
- Tables and Company Brain tabs remain reachable without clipping content.

## Live-adapter handoff

Before removing fixture labels:

- Authentication and authorization are enforced server-side.
- Organization lists are filtered by the authenticated account.
- Health, freshness, and notification states come from live adapters.
- Denials contain safe user copy and a traceable correlation ID.
- The complete checklist is rerun against the deployed environment.
