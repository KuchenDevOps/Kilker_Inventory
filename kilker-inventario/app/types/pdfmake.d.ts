// types/pdfmake.d.ts
//
// pdfmake 0.3 no publica tipos y `@types/pdfmake` describe la API de 0.2 (que
// cambió: ahora el vfs se inyecta con `addVirtualFileSystem`). Declaramos a
// mano lo poco que usamos del bundle de navegador.
//
// Sólo se usa el build de navegador (`pdfmake/build/*`): las fuentes van
// embebidas en base64 dentro de `vfs_fonts`, así que no hay archivos ni
// filesystem de por medio y nada de esto toca el servidor.

declare module 'pdfmake/build/pdfmake' {
  /**
   * Nodo de contenido de pdfmake. El modelo real es enorme y recursivo; esto
   * es sólo lo bastante laxo para construir el documento sin recurrir a `any`.
   */
  export type PdfContent =
    | string
    | number
    | { [key: string]: unknown }
    | PdfContent[]

  export interface PdfDocDefinition {
    content: PdfContent
    [key: string]: unknown
  }

  export interface PdfDocument {
    /** Dispara la descarga en el navegador. */
    download(defaultFileName?: string): void
    /** Abre el PDF en una pestaña nueva. */
    open(): void
    print(): void
    getBlob(callback: (blob: Blob) => void): void
  }

  export interface PdfMake {
    /** Registra las fuentes embebidas de `pdfmake/build/vfs_fonts`. */
    addVirtualFileSystem(vfs: Record<string, string>): void
    createPdf(docDefinition: PdfDocDefinition): PdfDocument
  }

  const pdfMake: PdfMake
  export default pdfMake
}

declare module 'pdfmake/build/vfs_fonts' {
  /** Fuentes Roboto en base64, indexadas por nombre de archivo. */
  const vfs: Record<string, string>
  export default vfs
}
