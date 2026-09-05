// ───────────────────────────────────────────────
//  Validación de datos de contacto.
//  Vive en shared/ porque la usan LOS DOS lados: la pantalla de clientes
//  (para deshabilitar el botón y avisar antes de mandar) y los endpoints
//  de customers (que son la validación real). Con una copia por lado,
//  un correo aceptado por la UI moría con 400 del servidor.
// ───────────────────────────────────────────────

/** Formato mínimo de correo: algo@algo.algo, sin espacios. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim())
}
