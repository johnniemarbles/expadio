/**
 * The DNS records a sending domain needs before governed email dispatch is
 * permitted, and how each is checked. One definition, shared by the list route,
 * the auto-configure route and the verify route, so what we show, what we
 * provision and what we check can never drift apart.
 *
 * SPF, DMARC and the return-path MX are deterministic and verifiable by DNS
 * resolution. DKIM is issued by the sending email provider (SES/Resend/…) — we
 * cannot invent a key that will validate, so it is marked non-verifiable and
 * labelled honestly rather than shown as passing.
 */

export type DnsRecordType = "TXT" | "MX" | "CNAME";

export interface DnsRecordSpec {
  readonly type: DnsRecordType;
  readonly name: string;
  readonly value: string;
  readonly priority?: number;
  /** Human label for what the record is for. */
  readonly purpose: string;
  /** Whether we can confirm it by DNS resolution (DKIM cannot, until issued). */
  readonly verifiable: boolean;
}

export function expectedDnsRecords(domain: string): DnsRecordSpec[] {
  return [
    {
      type: "TXT",
      name: domain,
      value: "v=spf1 include:amazonses.com include:_spf.resend.com ~all",
      purpose: "SPF",
      verifiable: true,
    },
    {
      type: "TXT",
      name: `_dmarc.${domain}`,
      value: `v=DMARC1; p=reject; pct=100; rua=mailto:dmarc-reports@${domain}`,
      purpose: "DMARC",
      verifiable: true,
    },
    {
      type: "MX",
      name: `mail.${domain}`,
      value: "feedback-smtp.us-east-1.amazonses.com",
      priority: 10,
      purpose: "Return-path (MX)",
      verifiable: true,
    },
    {
      type: "TXT",
      name: `resend._domainkey.${domain}`,
      value: "issued by your email provider — add the DKIM key it gives you",
      purpose: "DKIM",
      verifiable: false,
    },
  ];
}
