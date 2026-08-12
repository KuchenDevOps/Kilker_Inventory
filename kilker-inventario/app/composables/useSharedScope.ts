// ───────────────────────────────────────────────
//  SCOPE COMPARTIDO PARA WATCHERS DE COMPOSABLES
// ───────────────────────────────────────────────
import type { EffectScope } from 'vue'

type ScopeBag = Record<string, EffectScope | undefined>

/**
  * Permite que varios consumidores de un mismo composable compartan un watcher
 *
 * @param key   identificador único del composable (no reutilizar entre dos).
 * @param setup watchers y/o llamada inicial a `refresh()`.
 */
export function useSharedScope(key: string, setup: () => void) {
  if (!import.meta.client) return

  const bag = useNuxtApp() as unknown as ScopeBag
  const slot = `_sharedScope_${key}`
  if (bag[slot]) return

  const scope = effectScope(true) 
  bag[slot] = scope
  scope.run(setup)
}
