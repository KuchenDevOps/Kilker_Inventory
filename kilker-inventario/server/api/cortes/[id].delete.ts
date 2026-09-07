// ───────────────────────────────────────────────
//  DELETE /api/cortes/:id — borrar un corte de caja (admin)
// ───────────────────────────────────────────────
// Para cuando el corte se hizo por error o con la fecha mal. El corte es un
// SNAPSHOT recalculable de las ventas del periodo: no mueve dinero ni stock y
// ninguna otra tabla lo referencia, así que se borra de verdad (no hay baja
// suave) y lo que cubría vuelve a quedar sin cortar.
//
// ⚠️ **Solo el último corte de la sucursal.** El periodo de cada corte se
// encadena al cierre del anterior (`period_from` = `period_to` del previo), y
// ese encadenamiento se congela al insertarlo. Borrando el último, su periodo lo
// recoge íntegro el corte siguiente que se haga. Borrando uno de en medio, el
// que le sigue conserva su `period_from` viejo y ese periodo queda huérfano:
// ningún corte lo cubre y nadie se entera, porque cada corte por separado
// cuadra. Por eso se borran en orden, del más reciente hacia atrás.
import { eq, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { cashCloseouts, stores } from '../../db/schema'
import { fmtCorteDate, latestCloseoutOrder, newerCloseoutThan } from '../../utils/cortes'

export default defineEventHandler(async (event) => {
  await requireProfile(event, { role: 'admin' })

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id inválido' })

  const db = useDb()

  return await db.transaction(async (tx) => {
    const corte = await tx.query.cashCloseouts.findFirst({
      where: eq(cashCloseouts.id, id)
    })
    if (!corte) throw createError({ statusCode: 404, statusMessage: 'Corte no existe' })

    // Mismo candado que `POST /api/cortes`: leer "quién es el último" y actuar
    // tiene que ser atómico contra esa tienda. Sin él, un corte nuevo que entra
    // entre la lectura y el borrado deja de ser el último sin que este endpoint
    // se entere, y el borrado abre justo el hueco que la regla evita.
    await tx.execute(sql`SELECT id FROM ${stores} WHERE id = ${corte.storeId} FOR UPDATE`)

    // Se relee DESPUÉS del candado: entre la primera lectura y el bloqueo pudo
    // borrarse (otro admin) o cambiar.
    const fresh = await tx.query.cashCloseouts.findFirst({
      where: eq(cashCloseouts.id, id)
    })
    if (!fresh) throw createError({ statusCode: 404, statusMessage: 'Corte no existe' })

    const newer = await tx.query.cashCloseouts.findFirst({
      where: newerCloseoutThan(fresh.storeId, fresh.periodTo, fresh.id),
      orderBy: latestCloseoutOrder
    })
    if (newer) {
      throw createError({
        statusCode: 409,
        statusMessage:
          `Los cortes se borran del más reciente al más antiguo. ` +
          `Borra primero el del ${fmtCorteDate(newer.periodTo)}.`
      })
    }

    await tx.delete(cashCloseouts).where(eq(cashCloseouts.id, fresh.id))

    return {
      id: fresh.id,
      storeId: fresh.storeId,
      periodFrom: fresh.periodFrom,
      periodTo: fresh.periodTo,
      salesCount: fresh.salesCount,
      totalEmitido: fresh.totalEmitido
    }
  })
})
