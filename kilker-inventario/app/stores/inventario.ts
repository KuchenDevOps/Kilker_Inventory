import type {
  InventoryRow,
  Location,
  NewProductInput,
  Product
} from '~/types/inventario'

// ──────────────────────────────────────────────────────────────────────────
// Store de inventario.
//
// ⚠️ Los datos son MOCK en memoria (se pierden al recargar). Sirven para
// desarrollar las pantallas mientras se congelan las specs y se conecta el
// backend real. Cuando exista `server/api/` + Drizzle/Supabase, estas acciones
// pasarán a llamar a esos endpoints (useFetch/$fetch) sin cambiar la UI.
// ──────────────────────────────────────────────────────────────────────────

const seedLocations: Location[] = [
  { id: 'loc-mtz', name: 'Matriz Centro', code: 'MTZ', isActive: true },
  { id: 'loc-nte', name: 'Sucursal Norte', code: 'NTE', isActive: true },
  { id: 'loc-sur', name: 'Sucursal Sur', code: 'SUR', isActive: true }
]

const seedProducts: Product[] = [
  {
    id: 'prod-esm-bla-1l',
    sku: 'ESM-BLA-1L',
    name: 'Esmalte sintético blanco brillante 1 L',
    brand: 'Comex',
    category: 'Esmaltes',
    color: 'Blanco',
    colorCode: 'N-100',
    base: 'aceite',
    finish: 'Brillante',
    volume: 1,
    unit: 'L',
    price: 280,
    cost: 180,
    minQuantity: 10,
    isActive: true,
    createdAt: '2026-06-10T16:00:00.000Z'
  },
  {
    id: 'prod-vin-bla-19l',
    sku: 'VIN-BLA-19L',
    name: 'Pintura vinílica blanca mate 19 L',
    brand: 'Sherwin-Williams',
    category: 'Vinílicas',
    color: 'Blanco',
    base: 'agua',
    finish: 'Mate',
    volume: 19,
    unit: 'L',
    price: 1850,
    cost: 1200,
    minQuantity: 5,
    isActive: true,
    createdAt: '2026-06-12T16:00:00.000Z'
  },
  {
    id: 'prod-vin-azu-4l',
    sku: 'VIN-AZU-4L',
    name: 'Pintura vinílica azul cielo satinada 4 L',
    brand: 'Comex',
    category: 'Vinílicas',
    color: 'Azul cielo',
    colorCode: 'B-204',
    base: 'agua',
    finish: 'Satinado',
    volume: 4,
    unit: 'L',
    price: 620,
    cost: 400,
    minQuantity: 8,
    isActive: true,
    createdAt: '2026-06-15T16:00:00.000Z'
  },
  {
    id: 'prod-sel-4l',
    sku: 'SEL-4L',
    name: 'Sellador 5x1 vinílico 4 L',
    brand: 'Comex',
    category: 'Selladores',
    color: 'Blanco',
    base: 'agua',
    finish: 'Mate',
    volume: 4,
    unit: 'L',
    price: 540,
    cost: 350,
    minQuantity: 4,
    isActive: true,
    createdAt: '2026-06-16T16:00:00.000Z'
  },
  {
    id: 'prod-thi-1l',
    sku: 'THI-1L',
    name: 'Thinner estándar 1 L',
    brand: 'Sayer',
    category: 'Solventes',
    base: 'otro',
    volume: 1,
    unit: 'L',
    price: 95,
    cost: 60,
    minQuantity: 20,
    isActive: false,
    createdAt: '2026-06-18T16:00:00.000Z'
  }
]

// Existencias por (producto, sucursal). Algunas filas quedan bajo el mínimo
// a propósito para que el dashboard muestre alertas.
const seedInventory: InventoryRow[] = [
  { productId: 'prod-esm-bla-1l', locationId: 'loc-mtz', quantity: 4 },
  { productId: 'prod-esm-bla-1l', locationId: 'loc-nte', quantity: 3 },
  { productId: 'prod-vin-bla-19l', locationId: 'loc-mtz', quantity: 12 },
  { productId: 'prod-vin-bla-19l', locationId: 'loc-sur', quantity: 6 },
  { productId: 'prod-vin-azu-4l', locationId: 'loc-mtz', quantity: 9 },
  { productId: 'prod-vin-azu-4l', locationId: 'loc-nte', quantity: 5 },
  { productId: 'prod-sel-4l', locationId: 'loc-sur', quantity: 2 },
  { productId: 'prod-thi-1l', locationId: 'loc-mtz', quantity: 30 }
]

export const useInventarioStore = defineStore('inventario', () => {
  const products = ref<Product[]>([...seedProducts])
  const locations = ref<Location[]>([...seedLocations])
  const inventory = ref<InventoryRow[]>([...seedInventory])

  // ── Acciones ──────────────────────────────────────────────────────────
  /** Da de alta un producto y lo deja al frente de la lista. */
  function addProduct(input: NewProductInput): Product {
    const product: Product = {
      ...input,
      id: `prod-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString()
    }
    products.value.unshift(product)
    return product
  }

  /** ¿Ya existe un SKU? (la unicidad la garantizará la BD más adelante). */
  function skuExists(sku: string): boolean {
    const norm = sku.trim().toLowerCase()
    return products.value.some((p) => p.sku.toLowerCase() === norm)
  }

  /** Existencias totales de un producto sumando todas las sucursales. */
  function stockOf(productId: string): number {
    return inventory.value
      .filter((row) => row.productId === productId)
      .reduce((sum, row) => sum + row.quantity, 0)
  }

  // ── Getters / métricas ────────────────────────────────────────────────
  const totalProducts = computed(() => products.value.length)
  const activeProducts = computed(
    () => products.value.filter((p) => p.isActive).length
  )
  const totalCategories = computed(
    () => new Set(products.value.map((p) => p.category).filter(Boolean)).size
  )
  const totalLocations = computed(
    () => locations.value.filter((l) => l.isActive).length
  )
  const totalUnits = computed(() =>
    inventory.value.reduce((sum, row) => sum + row.quantity, 0)
  )
  /** Valor estimado del inventario: Σ (precio × existencias). */
  const inventoryValue = computed(() =>
    products.value.reduce(
      (sum, p) => sum + (p.price ?? 0) * stockOf(p.id),
      0
    )
  )
  /** Productos activos cuyas existencias están por debajo del mínimo. */
  const lowStock = computed(() =>
    products.value
      .filter((p) => p.isActive && p.minQuantity != null)
      .map((p) => ({ product: p, stock: stockOf(p.id) }))
      .filter((row) => row.stock < (row.product.minQuantity ?? 0))
      .sort((a, b) => a.stock - b.stock)
  )
  /** Últimos productos dados de alta. */
  const recentProducts = computed(() =>
    [...products.value]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6)
  )

  return {
    products,
    locations,
    inventory,
    addProduct,
    skuExists,
    stockOf,
    totalProducts,
    activeProducts,
    totalCategories,
    totalLocations,
    totalUnits,
    inventoryValue,
    lowStock,
    recentProducts
  }
})
