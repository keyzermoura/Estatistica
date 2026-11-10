/**
 * Registro de perfis de método.
 *
 * O perfil analítico e o dimensional estão registrados. Famílias ainda sem
 * módulos próprios usam o perfil analítico como fallback, sem quebrar telas de
 * métodos já classificados.
 */

import type { Method, MethodFamily } from '../lib/types';
import type { MethodProfile } from './types';
import { ANALYTICAL_PROFILE } from './analytical';
import { DIMENSIONAL_PROFILE } from './dimensional';

export const DEFAULT_PROFILE_ID = 'analytical';

const REGISTRY: Record<string, MethodProfile> = {
  [ANALYTICAL_PROFILE.id]: ANALYTICAL_PROFILE,
  [DIMENSIONAL_PROFILE.id]: DIMENSIONAL_PROFILE,
};

/** Retorna o perfil pelo identificador; família desconhecida falha explicitamente. */
export function getProfile(family: string): MethodProfile {
  const key = family.trim().toLowerCase();
  const profile = REGISTRY[key];
  if (!profile) {
    throw new Error(
      `Perfil de método desconhecido: "${family}". Perfis disponíveis: ${Object.keys(REGISTRY).join(', ')}.`,
    );
  }
  return profile;
}

/**
 * Perfil ativo para um método. A família já é persistida (migração v2), mas
 * apenas o perfil analítico está registrado; as demais famílias usam o perfil
 * analítico como fallback até que seus módulos sejam implementados nos
 * próximos prompts. Isso evita quebrar telas ao classificar um método.
 */
export function getProfileForMethod(method?: Method): MethodProfile {
  const family = method?.family;
  if (family && REGISTRY[family]) return REGISTRY[family];
  return getProfile(DEFAULT_PROFILE_ID);
}

/**
 * Perfil ativo para uma família viva da interface (por exemplo, a família
 * escolhida no cadastro do método). Famílias sem perfil registrado usam o
 * perfil analítico, preservando o comportamento anterior.
 */
export function getProfileForFamily(
  family?: MethodFamily | string | null,
): MethodProfile {
  const key = family?.trim().toLowerCase();
  if (key && REGISTRY[key]) return REGISTRY[key];
  return getProfile(DEFAULT_PROFILE_ID);
}

export function listProfiles(): MethodProfile[] {
  return Object.values(REGISTRY);
}
