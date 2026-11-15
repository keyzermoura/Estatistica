import { describe, expect, it, vi } from 'vitest';
import {
  exportChartAsSvg,
  exportChartAsPng300Dpi,
  findSvgElement,
  serializeSvg,
} from '../chartExport';

function createMockSvg(width = 600, height = 300) {
  const attrs: Record<string, string> = {
    width: String(width),
    height: String(height),
  };
  const children: any[] = [];

  const mockSvg: any = {
    tagName: 'svg',
    getAttribute: (name: string) => attrs[name] || null,
    setAttribute: (name: string, val: string) => {
      attrs[name] = val;
    },
    getBoundingClientRect: () => ({ width, height }),
    cloneNode: () => createMockSvg(width, height),
    insertBefore: (node: any) => children.unshift(node),
    firstChild: null,
    get outerHTML() {
      return `<svg width="${attrs.width}" height="${attrs.height}" xmlns="${attrs.xmlns || ''}" viewBox="${attrs.viewBox || ''}"><rect fill="#ffffff"/></svg>`;
    },
  };
  return mockSvg;
}

describe('chartExport - Exportação Gráfica em Alta Resolução', () => {
  it('localiza o elemento SVG direto ou aninhado em container', () => {
    const directSvg = createMockSvg();
    expect(findSvgElement(directSvg)).toBe(directSvg);

    const nestedSvg = createMockSvg();
    const container: any = {
      querySelector: (sel: string) => (sel === 'svg' ? nestedSvg : null),
    };
    expect(findSvgElement(container)).toBe(nestedSvg);

    const emptyContainer: any = {
      querySelector: () => null,
    };
    expect(findSvgElement(emptyContainer)).toBeNull();
  });

  it('serializa o SVG com namespaces, dimensões e fundo opaco de publicação', () => {
    const svg = createMockSvg(600, 300);

    const { svgString, width, height } = serializeSvg(svg, { backgroundColor: '#ffffff' });

    expect(width).toBe(600);
    expect(height).toBe(300);
    expect(svgString).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(svgString).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svgString).toContain('viewBox="0 0 600 300"');
    expect(svgString).toContain('<rect fill="#ffffff"/>');
  });

  it('lança erro ao tentar serializar container sem SVG', () => {
    const emptyContainer: any = {
      querySelector: () => null,
    };
    expect(() => serializeSvg(emptyContainer)).toThrow(
      'Nenhum elemento gráfico SVG encontrado para exportação.',
    );
  });

  it('exporta SVG gerando download com extensão correta', () => {
    const svg = createMockSvg(400, 200);

    const clickSpy = vi.fn();
    const createUrlSpy = vi.fn().mockReturnValue('blob:test-url');
    const revokeUrlSpy = vi.fn();

    vi.stubGlobal('URL', {
      createObjectURL: createUrlSpy,
      revokeObjectURL: revokeUrlSpy,
    });

    const mockAnchor: any = {
      href: '',
      download: '',
      click: clickSpy,
    };

    vi.stubGlobal('document', {
      createElement: (tag: string) => (tag === 'a' ? mockAnchor : {}),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    });

    exportChartAsSvg(svg, 'meu-grafico');

    expect(mockAnchor.download).toBe('meu-grafico.svg');
    expect(createUrlSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('exporta PNG em 300 DPI calculando escala de resolução (300/96)', async () => {
    const svg = createMockSvg(400, 200);

    let canvasCreated: any = null;
    const mockAnchor: any = {
      href: '',
      download: '',
      click: vi.fn(),
    };

    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag === 'canvas') {
          canvasCreated = {
            width: 0,
            height: 0,
            getContext: () => ({
              fillStyle: '',
              fillRect: vi.fn(),
              drawImage: vi.fn(),
            }),
            toBlob: (callback: any) => {
              callback(new Blob(['png-bytes'], { type: 'image/png' }));
            },
          };
          return canvasCreated;
        }
        if (tag === 'a') {
          return mockAnchor;
        }
        return {};
      },
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    });

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:test-url'),
      revokeObjectURL: vi.fn(),
    });

    vi.stubGlobal(
      'Image',
      class MockImage {
        onload: (() => void) | null = null;
        set src(_val: string) {
          setTimeout(() => this.onload && this.onload(), 5);
        }
      },
    );

    await exportChartAsPng300Dpi(svg, 'grafico-teste.png', { dpi: 300 });

    expect(canvasCreated).not.toBeNull();
    // 400 * (300 / 96) = 1250 px
    expect(canvasCreated.width).toBe(1250);
    // 200 * (300 / 96) = 625 px
    expect(canvasCreated.height).toBe(625);
    expect(mockAnchor.download).toBe('grafico-teste.png');

    vi.restoreAllMocks();
  });

  it('empacota múltiplos gráficos em arquivo ZIP estruturado com pastas svg_vetorial e png_300dpi', async () => {
    const svg1 = createMockSvg(400, 200);
    const svg2 = createMockSvg(500, 250);

    const mockAnchor: any = {
      href: '',
      download: '',
      click: vi.fn(),
    };

    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag === 'canvas') {
          return {
            width: 0,
            height: 0,
            getContext: () => ({
              fillStyle: '',
              fillRect: vi.fn(),
              drawImage: vi.fn(),
            }),
            toBlob: (callback: any) => {
              callback(new Blob(['png-bytes'], { type: 'image/png' }));
            },
          };
        }
        if (tag === 'a') {
          return mockAnchor;
        }
        return {};
      },
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    });

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:test-zip-url'),
      revokeObjectURL: vi.fn(),
    });

    vi.stubGlobal(
      'Image',
      class MockImage {
        onload: (() => void) | null = null;
        set src(_val: string) {
          setTimeout(() => this.onload && this.onload(), 5);
        }
      },
    );

    const { exportAllChartsAsZip } = await import('../chartExport');

    await exportAllChartsAsZip(
      [
        { filename: 'histograma', target: svg1 },
        { filename: 'qq-plot', target: svg2 },
      ],
      'lote-figuras.zip',
    );

    expect(mockAnchor.download).toBe('lote-figuras.zip');
    expect(mockAnchor.click).toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});
