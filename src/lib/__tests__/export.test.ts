import { describe, expect, it } from 'vitest';
import { escapeHtml, buildReportHtmlString } from '../export';
import type { ReportRecord } from '../types';

describe('XSS prevention in export.ts', () => {
  it('escapa caracteres especiais HTML (&, <, >, ", \')', () => {
    const malicious = '<script>alert("XSS")</script> & "teste" \'aspas\'';
    const escaped = escapeHtml(malicious);

    expect(escaped).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt; &amp; &quot;teste&quot; &#039;aspas&#039;');
    expect(escaped).not.toContain('<script>');
    expect(escaped).not.toContain('& ');
  });

  it('protege o título do relatório gerado contra injeção de script no HTML exportado', () => {
    const fakeReport = {
      id: 'rep-1',
      validationId: 'val-1',
      version: 1,
      status: 'draft',
      content: {
        title: '<script>evil()</script> & Validação Final <img src=x onerror=alert(1)>',
        method: { code: 'M1', name: 'Metodo' },
        generatedAt: '2026-11-19T00:00:00Z',
        validation: { title: 'Val' },
        summary: {},
        parameters: [],
        auditHash: 'abc',
        signatures: [],
      },
      elaboratedBy: '',
      reviewedBy: '',
      approvedBy: '',
      elaboratedAt: null,
      reviewedAt: null,
      approvedAt: null,
      locked: false,
      createdAt: '2026-11-19T00:00:00Z',
      updatedAt: '2026-11-19T00:00:00Z',
    } as unknown as ReportRecord;

    const html = buildReportHtmlString(fakeReport, '<div>Conteúdo</div>');

    expect(html).toContain('<title>&lt;script&gt;evil()&lt;/script&gt; &amp; Validação Final &lt;img src=x onerror=alert(1)&gt;</title>');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).toContain('<div>Conteúdo</div>');
  });
});
