/**
 * Registro de perfis de método.
 *
 * Nesta etapa existe apenas o perfil analítico. Os próximos perfis (dimensional,
 * físico destrutivo/não destrutivo e atributo) serão registrados aqui, sem que
 * a orquestração ou a interface precisem de um novo switch.
 */

import type { Method } from '../lib/types';
import type { MethodProfile } from './types';
import { ANALYTICAL_PROFILE } from './analytical';

export const DEFAULT_PROFILE_ID = 'analytical';

const REGISTRY: Record<string, MethodProfile> = {
  [ANALYTICAL_PROFILE.id]: ANALYTICAL_PROFILE,
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

export function listProfiles(): MethodProfile[] {
  return Object.values(REGISTRY);
}
