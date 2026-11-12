/**
 * Registro de perfis de método.
 *
 * Os perfis analítico, dimensional e de atributo estão registrados. Famílias
 * ainda sem módulos próprios usam o perfil analítico como fallback, sem quebrar
 * telas de métodos já classificados.
 */

import type { Method, MethodFamily } from '../lib/types';
import type { MethodProfile } from './types';
import { ANALYTICAL_PROFILE } from './analytical';
import { DIMENSIONAL_PROFILE } from './dimensional';
import { ATTRIBUTE_PROFILE } from './attribute';

export const DEFAULT_PROFILE_ID = 'analytical';

const REGISTRY: Record<string, MethodProfile> = {
  [ANALYTICAL_PROFILE.id]: ANALYTICAL_PROFILE,
  [DIMENSIONAL_PROFILE.id]: DIMENSIONAL_PROFILE,
  [ATTRIBUTE_PROFILE.id]: ATTRIBUTE_PROFILE,
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
 * Perfil ativo para um método. A família é persistida (migração v2) e os
 * perfis registrados são usados; famílias ainda sem módulos próprios usam o
 * perfil analítico como fallback para não quebrar telas.
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
