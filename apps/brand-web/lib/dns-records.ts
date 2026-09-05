export type DnsRecordType = 'TXT' | 'MX' | 'CNAME';

export interface DnsRecordSpec {
  readonly type: DnsRecordType;
  readonly name: string;
  readonly value: string;
  readonly priority?: number;
  readonly purpose: string;
  /** Whether we can confirm this record by DNS resolution (DKIM cannot, until issued by provider). */
  readonly verifiable: boolean;
}

export function expectedDnsRecords(domain: string): DnsRecordSpec[] {
  return [
    {
      type: 'TXT',
      name: domain,
      value: 'v=spf1 include:amazonses.com include:_spf.resend.com ~all',
      purpose: 'SPF',
      verifiable: true,
    },
    {
      type: 'TXT',
      name: `_dmarc.${domain}`,
      value: `v=DMARC1; p=reject; pct=100; rua=mailto:dmarc-reports@${domain}`,
      purpose: 'DMARC',
      verifiable: true,
    },
    {
      type: 'MX',
      name: `mail.${domain}`,
      value: 'feedback-smtp.us-east-1.amazonses.com',
      priority: 10,
      purpose: 'Return-path (MX)',
      verifiable: true,
    },
    {
      type: 'TXT',
      name: `resend._domainkey.${domain}`,
      value: 'Issued by Resend — add the DKIM key from your Resend domain settings',
      purpose: 'DKIM',
      verifiable: false,
    },
  ];
}
