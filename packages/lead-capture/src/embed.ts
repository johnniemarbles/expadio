/**
 * Embedded capture form — the drop-in snippet for the PUBLIC rail.
 *
 * A site owner adds one form with data attributes and this script; on submit it
 * builds a submission from named inputs and posts through the browser client. It
 * carries a honeypot and never holds a secret. It is intentionally tiny and
 * framework-free; a bundler can emit an IIFE from this module for a plain
 * `<script src>` embed.
 *
 * Markup contract:
 *   <form data-expadio-capture
 *         data-base-url="https://api.expadio.com"
 *         data-tenant-id="…" data-source-id="…"
 *         data-publishable-key="cpk_…">
 *     <input name="email" type="email" required>
 *     <input name="firstName"> <input name="lastName"> <input name="phone">
 *     <input name="company">
 *     <input data-field="investment_range" name="investment_range">
 *     <input data-expadio-honeypot name="company_website" tabindex="-1" autocomplete="off">
 *   </form>
 */
import { createBrowserCaptureClient } from './client.ts';
import type { CaptureFieldValue, CaptureSubmissionInput } from './contract.ts';

export interface MountedCaptureForm {
  /** Complete the OTP gate for a lead this form captured. */
  verify(captureLeadId: string, code: string): Promise<{ verified: boolean }>;
  destroy(): void;
}

function value(form: HTMLFormElement, name: string): string | undefined {
  const el = form.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`);
  const raw = el?.value?.trim();
  return raw ? raw : undefined;
}

function collectInput(form: HTMLFormElement): CaptureSubmissionInput {
  const fields: Record<string, CaptureFieldValue> = {};
  form.querySelectorAll<HTMLInputElement>('[data-field]').forEach((el) => {
    const key = el.getAttribute('data-field');
    if (key && el.value.trim() !== '') fields[key] = el.value.trim();
  });

  const firstName = value(form, 'firstName') ?? value(form, 'first_name');
  const lastName = value(form, 'lastName') ?? value(form, 'last_name');
  const phone = value(form, 'phone');
  const companyName = value(form, 'company') ?? value(form, 'organization');
  const extRef = value(form, 'externalReference');
  const formId = form.getAttribute('data-form-id') ?? undefined;
  const formVersion = form.getAttribute('data-form-version') ?? undefined;

  return {
    contact: {
      email: value(form, 'email') ?? '',
      ...(firstName !== undefined ? { firstName } : {}),
      ...(lastName !== undefined ? { lastName } : {}),
      ...(phone !== undefined ? { phone } : {}),
    },
    ...(companyName !== undefined ? { organization: { name: companyName } } : {}),
    ...(extRef !== undefined ? { externalReference: extRef } : {}),
    ...(formId !== undefined ? { formId } : {}),
    ...(formVersion !== undefined ? { formVersion } : {}),
    fields,
  };
}

function honeypotTripped(form: HTMLFormElement): boolean {
  const trap = form.querySelector<HTMLInputElement>('[data-expadio-honeypot]');
  return !!trap && trap.value.trim() !== '';
}

function emit(form: HTMLFormElement, name: string, detail: unknown): void {
  form.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
}

/** Wire a single form. Emits `expadio:capture:success` / `:error` events. */
export function mountCaptureForm(form: HTMLFormElement): MountedCaptureForm {
  const baseUrl = form.getAttribute('data-base-url');
  const tenantId = form.getAttribute('data-tenant-id');
  const sourceId = form.getAttribute('data-source-id');
  const publishableKey = form.getAttribute('data-publishable-key');
  if (!baseUrl || !tenantId || !sourceId || !publishableKey) {
    throw new Error('data-base-url, data-tenant-id, data-source-id and data-publishable-key are required on a capture form.');
  }
  const client = createBrowserCaptureClient({ baseUrl, tenantId, sourceId, publishableKey });

  const onSubmit = async (event: Event) => {
    event.preventDefault();
    // A tripped honeypot: pretend success, submit nothing. Bots get no signal.
    if (honeypotTripped(form)) {
      emit(form, 'expadio:capture:success', { accepted: true, replayed: false, captureLeadId: null, requiresVerification: false });
      return;
    }
    form.setAttribute('data-submitting', 'true');
    try {
      const result = await client.submit(collectInput(form));
      emit(form, 'expadio:capture:success', result);
      if (!result.requiresVerification) form.reset();
    } catch (error) {
      emit(form, 'expadio:capture:error', { message: error instanceof Error ? error.message : 'Submission failed.' });
    } finally {
      form.removeAttribute('data-submitting');
    }
  };

  form.addEventListener('submit', onSubmit);
  return {
    verify: (captureLeadId: string, code: string) => client.verify(captureLeadId, code),
    destroy: () => form.removeEventListener('submit', onSubmit),
  };
}

/** Auto-mount every `[data-expadio-capture]` form once the DOM is ready. */
export function autoMountCaptureForms(): void {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return;
  const mount = () => doc.querySelectorAll<HTMLFormElement>('form[data-expadio-capture]').forEach((form) => {
    if (form.getAttribute('data-expadio-mounted') === 'true') return;
    form.setAttribute('data-expadio-mounted', 'true');
    mountCaptureForm(form);
  });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount);
  else mount();
}
