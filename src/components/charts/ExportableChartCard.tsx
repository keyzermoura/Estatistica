import { useRef, useState, type ReactNode } from 'react';
import { Download, FileCode, ImageIcon } from 'lucide-react';
import { exportChartAsPng300Dpi, exportChartAsSvg } from './chartExport';
import { Button, useToast } from '../ui';

export interface ExportableChartCardProps {
  title?: string;
  subtitle?: string;
  filenameBase: string;
  badge?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function ExportableChartCard({
  title,
  subtitle,
  filenameBase,
  badge,
  headerAction,
  children,
  className = '',
}: ExportableChartCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [exportingPng, setExportingPng] = useState(false);
  const toast = useToast();

  const handleExportSvg = () => {
    if (!containerRef.current) return;
    try {
      exportChartAsSvg(containerRef.current, `${filenameBase}.svg`);
      toast.push(`Gráfico exportado em SVG vetorial (${filenameBase}.svg).`);
    } catch (err) {
      toast.push(
        err instanceof Error ? err.message : 'Falha ao exportar gráfico em SVG.',
        'danger',
      );
    }
  };

  const handleExportPng = async () => {
    if (!containerRef.current) return;
    setExportingPng(true);
    try {
      await exportChartAsPng300Dpi(containerRef.current, `${filenameBase}-300dpi.png`, {
        dpi: 300,
      });
      toast.push(`Gráfico exportado em PNG 300 DPI (${filenameBase}-300dpi.png).`);
    } catch (err) {
      toast.push(
        err instanceof Error ? err.message : 'Falha ao exportar gráfico em PNG 300 DPI.',
        'danger',
      );
    } finally {
      setExportingPng(false);
    }
  };

  return (
    <div
      data-export-chart-card="true"
      data-export-filename={filenameBase}
      className={`rounded-xl border border-ink-200 bg-surface-50/50 p-3 dark:border-ink-800 dark:bg-ink-950/20 ${className}`}
    >
      {(title || headerAction || badge) && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 pb-2 dark:border-ink-800/60">
          <div>
            {title && (
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-ink-700 dark:text-ink-200">{title}</p>
                {badge}
              </div>
            )}
            {subtitle && <p className="text-[11px] text-ink-400">{subtitle}</p>}
          </div>

          <div className="flex items-center gap-1.5">
            {headerAction}
            <div className="flex items-center rounded-lg border border-ink-200 bg-surface-0 p-0.5 shadow-xs dark:border-ink-700 dark:bg-ink-900">
              <button
                type="button"
                onClick={handleExportSvg}
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-200 transition"
                title="Exportar gráfico vetorial (.svg) para relatórios e periódicos"
              >
                <FileCode className="h-3 w-3 text-brand-600 dark:text-brand-400" />
                <span>SVG</span>
              </button>
              <span className="h-3 w-px bg-ink-200 dark:bg-ink-700" />
              <button
                type="button"
                onClick={handleExportPng}
                disabled={exportingPng}
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-50 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-200 transition"
                title="Exportar imagem em alta resolução rasterizada a 300 DPI (.png)"
              >
                <ImageIcon className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                <span>{exportingPng ? '300 DPI…' : 'PNG 300 DPI'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div ref={containerRef} className="relative w-full">
        {children}
      </div>
    </div>
  );
}
