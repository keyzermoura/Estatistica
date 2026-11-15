import { describe, expect, it } from 'vitest';
import { calculateVirtualWindow } from '../useVirtualTable';

describe('calculateVirtualWindow', () => {
  it('não ativa virtualização para datasets menores ou iguais ao threshold', () => {
    const result = calculateVirtualWindow({
      totalItems: 30,
      scrollTop: 0,
      containerHeight: 600,
      rowHeight: 44,
      overscan: 10,
      threshold: 40,
    });

    expect(result.isVirtual).toBe(false);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(30);
    expect(result.topSpacerHeight).toBe(0);
    expect(result.bottomSpacerHeight).toBe(0);
  });

  it('ativa virtualização para datasets grandes calculando startIndex, endIndex e spacers no topo', () => {
    const result = calculateVirtualWindow({
      totalItems: 500,
      scrollTop: 0,
      containerHeight: 440, // 10 linhas visíveis
      rowHeight: 44,
      overscan: 5,
      threshold: 40,
    });

    expect(result.isVirtual).toBe(true);
    expect(result.startIndex).toBe(0); // 0 - 5 clamp em 0
    expect(result.endIndex).toBe(15); // 0 + 10 visiveis + 5 overscan
    expect(result.topSpacerHeight).toBe(0);
    expect(result.bottomSpacerHeight).toBe((500 - 15) * 44);
  });

  it('calcula janelas no meio da tabela corretamente com spacers em ambos os lados', () => {
    // scrollTop = 4400 -> rawStartIndex = 100
    // visibleCount = 440 / 44 = 10
    // overscan = 5 -> startIndex = 95, endIndex = 115
    const result = calculateVirtualWindow({
      totalItems: 1000,
      scrollTop: 4400,
      containerHeight: 440,
      rowHeight: 44,
      overscan: 5,
      threshold: 40,
    });

    expect(result.isVirtual).toBe(true);
    expect(result.startIndex).toBe(95);
    expect(result.endIndex).toBe(115);
    expect(result.topSpacerHeight).toBe(95 * 44);
    expect(result.bottomSpacerHeight).toBe((1000 - 115) * 44);
  });

  it('respeita o limite inferior e não ultrapassa totalItems no final da tabela', () => {
    // scrollTop = 44000 (muito além de 100 itens)
    const result = calculateVirtualWindow({
      totalItems: 100,
      scrollTop: 44000,
      containerHeight: 440,
      rowHeight: 44,
      overscan: 5,
      threshold: 40,
    });

    expect(result.isVirtual).toBe(true);
    expect(result.endIndex).toBe(100);
    expect(result.bottomSpacerHeight).toBe(0);
  });
});
