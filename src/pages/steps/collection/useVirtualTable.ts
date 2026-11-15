import { useCallback, useEffect, useState } from 'react';

export interface VirtualWindowParams {
  totalItems: number;
  scrollTop: number;
  containerHeight: number;
  rowHeight: number;
  overscan: number;
  threshold: number;
}

export interface VirtualWindowResult {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  isVirtual: boolean;
}

/**
 * Cálculo determinístico da janela virtual para tabelas de medições com altura de linha fixa.
 */
export function calculateVirtualWindow({
  totalItems,
  scrollTop,
  containerHeight,
  rowHeight,
  overscan,
  threshold,
}: VirtualWindowParams): VirtualWindowResult {
  if (totalItems <= threshold) {
    return {
      startIndex: 0,
      endIndex: totalItems,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      isVirtual: false,
    };
  }

  const safeRowHeight = Math.max(1, rowHeight);
  const rawStartIndex = Math.floor(Math.max(0, scrollTop) / safeRowHeight);
  const visibleCount = Math.ceil(Math.max(0, containerHeight) / safeRowHeight);

  const startIndex = Math.max(0, rawStartIndex - overscan);
  const endIndex = Math.min(totalItems, rawStartIndex + visibleCount + overscan);

  const topSpacerHeight = startIndex * safeRowHeight;
  const bottomSpacerHeight = Math.max(0, (totalItems - endIndex) * safeRowHeight);

  return {
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    isVirtual: true,
  };
}

export interface UseVirtualTableOptions {
  totalItems: number;
  rowHeight?: number;
  overscan?: number;
  threshold?: number;
  containerRef: React.RefObject<HTMLElement | null>;
}

export interface UseVirtualTableResult {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  isVirtual: boolean;
  scrollToIndex: (index: number) => void;
}

/**
 * Hook leve e sem dependências externas para virtualização de tabelas com altura de linha fixa.
 * Ativa automaticamente quando totalItems ultrapassa o threshold (padrão: 40 linhas).
 */
export function useVirtualTable({
  totalItems,
  rowHeight = 44,
  overscan = 10,
  threshold = 40,
  containerRef,
}: UseVirtualTableOptions): UseVirtualTableResult {
  const isVirtual = totalItems > threshold;

  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isVirtual) return;

    let frameId: number | null = null;

    const handleScroll = () => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        setScrollTop(container.scrollTop);
        if (container.clientHeight > 0 && container.clientHeight !== containerHeight) {
          setContainerHeight(container.clientHeight);
        }
        frameId = null;
      });
    };

    setScrollTop(container.scrollTop);
    if (container.clientHeight > 0) {
      setContainerHeight(container.clientHeight);
    }

    container.addEventListener('scroll', handleScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.height > 0) {
            setContainerHeight(entry.contentRect.height);
          }
        }
      });
      resizeObserver.observe(container);
    }

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      container.removeEventListener('scroll', handleScroll);
      resizeObserver?.disconnect();
    };
  }, [containerRef, isVirtual, containerHeight]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const container = containerRef.current;
      if (!container || index < 0 || index >= totalItems) return;

      const targetTop = index * rowHeight;
      const targetBottom = targetTop + rowHeight;
      const currentTop = container.scrollTop;
      const currentBottom = currentTop + container.clientHeight;

      if (targetTop < currentTop) {
        container.scrollTop = Math.max(0, targetTop - rowHeight);
      } else if (targetBottom > currentBottom) {
        container.scrollTop = targetBottom - container.clientHeight + rowHeight;
      }
    },
    [containerRef, rowHeight, totalItems],
  );

  const windowResult = calculateVirtualWindow({
    totalItems,
    scrollTop,
    containerHeight,
    rowHeight,
    overscan,
    threshold,
  });

  return {
    ...windowResult,
    scrollToIndex,
  };
}
