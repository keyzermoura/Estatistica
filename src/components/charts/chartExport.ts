import JSZip from 'jszip';

/**
 * Utilitários de exportação gráfica em alta resolução para relatórios metrológicos,
 * auditorias e publicações científicas/periódicos (ISO 5725 / Eurachem / GUM).
 *
 * Suporta:
 * 1. Exportação Vetorial SVG nativo (editável em Illustrator, Inkscape, LaTeX).
 * 2. Exportação Raster PNG em 300 DPI (alta resolução de impressão, escala 3.125x sobre 96 DPI).
 * 3. Exportação em lote de todas as figuras da análise em pacote ZIP organizado.
 */

export interface ExportChartOptions {
  filename?: string;
  dpi?: number;
  backgroundColor?: string;
}

/**
 * Localiza o elemento <svg> dentro do container (ou o próprio elemento caso já seja SVG).
 */
export function findSvgElement(target: HTMLElement | SVGSVGElement): SVGSVGElement | null {
  if (typeof SVGSVGElement !== 'undefined' && target instanceof SVGSVGElement) {
    return target;
  }
  if (target && 'tagName' in target && (target as { tagName?: string }).tagName?.toLowerCase() === 'svg') {
    return target as SVGSVGElement;
  }
  if (target && typeof target.querySelector === 'function') {
    return target.querySelector('svg');
  }
  return null;
}

/**
 * Serializa o SVG em uma string XML válida, garantindo namespaces, dimensões e fundo opaco.
 */
export function serializeSvg(
  target: HTMLElement | SVGSVGElement,
  options: ExportChartOptions = {},
): { svgString: string; width: number; height: number } {
  const svg = findSvgElement(target);
  if (!svg) {
    throw new Error('Nenhum elemento gráfico SVG encontrado para exportação.');
  }

  const clone = (svg.cloneNode ? svg.cloneNode(true) : svg) as SVGSVGElement;

  // Determina dimensões naturais
  const rect = typeof svg.getBoundingClientRect === 'function' ? svg.getBoundingClientRect() : null;
  const widthAttr = typeof svg.getAttribute === 'function' ? svg.getAttribute('width') : null;
  const heightAttr = typeof svg.getAttribute === 'function' ? svg.getAttribute('height') : null;

  const width =
    (rect && rect.width > 0 ? Math.round(rect.width) : 0) ||
    (widthAttr ? parseInt(widthAttr, 10) : 0) ||
    800;
  const height =
    (rect && rect.height > 0 ? Math.round(rect.height) : 0) ||
    (heightAttr ? parseInt(heightAttr, 10) : 0) ||
    400;

  // Garante namespaces essenciais
  if (typeof clone.setAttribute === 'function') {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }

  // Injeta fundo opaco para publicação
  const bgColor = options.backgroundColor ?? '#ffffff';
  if (typeof document !== 'undefined' && typeof document.createElementNS === 'function') {
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', '0');
    bgRect.setAttribute('y', '0');
    bgRect.setAttribute('width', '100%');
    bgRect.setAttribute('height', '100%');
    bgRect.setAttribute('fill', bgColor);
    if (typeof clone.insertBefore === 'function') {
      clone.insertBefore(bgRect, clone.firstChild);
    }
  }

  // Serializa para XML
  let svgString = '';
  if (typeof XMLSerializer !== 'undefined') {
    const serializer = new XMLSerializer();
    svgString = serializer.serializeToString(clone);
  } else if ('outerHTML' in clone) {
    svgString = (clone as unknown as { outerHTML: string }).outerHTML;
  }

  if (svgString && !svgString.startsWith('<?xml')) {
    svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;
  }

  return { svgString, width, height };
}

/**
 * Dispara o download de um Blob no navegador.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exporta o gráfico diretamente como arquivo vetorial .svg.
 */
export function exportChartAsSvg(
  target: HTMLElement | SVGSVGElement,
  filename = 'grafico-metrologico.svg',
  options: ExportChartOptions = {},
): void {
  const safeFilename = filename.endsWith('.svg') ? filename : `${filename}.svg`;
  const { svgString } = serializeSvg(target, options);
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  triggerDownload(blob, safeFilename);
}

/**
 * Renderiza um elemento gráfico SVG para Blob PNG com resolução configurável (padrão 300 DPI).
 */
export async function renderSvgToPngBlob(
  target: HTMLElement | SVGSVGElement,
  options: ExportChartOptions = {},
): Promise<Blob> {
  const dpi = options.dpi ?? 300;
  // Escala de DPI relativa ao padrão 96 DPI dos navegadores
  const scale = dpi / 96;

  const { svgString, width, height } = serializeSvg(target, options);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Não foi possível obter contexto 2D do Canvas.');
  }

  // Preenchimento de fundo de alta qualidade
  ctx.fillStyle = options.backgroundColor ?? '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Falha ao renderizar SVG no Canvas'));
      img.src = url;
    });

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    );

    if (!pngBlob) {
      throw new Error('Falha ao gerar Blob PNG a partir do Canvas.');
    }

    return pngBlob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Exporta o gráfico como imagem rasterizada PNG em 300 DPI (alta resolução).
 */
export async function exportChartAsPng300Dpi(
  target: HTMLElement | SVGSVGElement,
  filename = 'grafico-metrologico-300dpi.png',
  options: ExportChartOptions = {},
): Promise<void> {
  const safeFilename = filename.endsWith('.png') ? filename : `${filename}.png`;
  const pngBlob = await renderSvgToPngBlob(target, options);
  triggerDownload(pngBlob, safeFilename);
}

export interface ChartExportItem {
  filename: string;
  target: HTMLElement | SVGSVGElement;
}

/**
 * Empacota uma lista de gráficos em um único arquivo .ZIP contendo as versões .svg e .png (300 DPI).
 */
export async function exportAllChartsAsZip(
  charts: ChartExportItem[],
  zipFilename = 'pacote-graficos-300dpi.zip',
): Promise<void> {
  if (!charts.length) {
    throw new Error('Nenhum gráfico encontrado para exportação.');
  }

  const zip = new JSZip();
  const svgFolder = zip.folder('svg_vetorial') ?? zip;
  const pngFolder = zip.folder('png_300dpi') ?? zip;

  for (let i = 0; i < charts.length; i++) {
    const item = charts[i];
    const prefix = String(i + 1).padStart(2, '0');
    const baseName = `${prefix}_${item.filename.replace(/\.(svg|png)$/i, '')}`;

    // SVG
    const { svgString } = serializeSvg(item.target);
    svgFolder.file(`${baseName}.svg`, svgString);

    // PNG 300 DPI
    const pngBlob = await renderSvgToPngBlob(item.target, { dpi: 300 });
    const pngBytes = await pngBlob.arrayBuffer();
    pngFolder.file(`${baseName}-300dpi.png`, pngBytes);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const safeZipFilename = zipFilename.endsWith('.zip') ? zipFilename : `${zipFilename}.zip`;
  triggerDownload(zipBlob, safeZipFilename);
}
