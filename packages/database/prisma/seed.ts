import { PrismaClient, NcfType, Role } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { randomBytes, scryptSync } from 'crypto'

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function defaultExpiry(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d
}

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:admin@localhost:5433/minimarket'
const pool = new pg.Pool({ connectionString: DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const categoryDefs = [
  { name: 'Bebidas', slug: 'BEBIDAS' },
  { name: 'Alimentos', slug: 'ALIMENTOS' },
  { name: 'Limpieza', slug: 'LIMPIEZA' },
  { name: 'Cuidado Personal', slug: 'CUIDADO_PERSONAL' },
  { name: 'Otros', slug: 'OTROS' },
]

const ProductType = { PRODUCT: 'PRODUCT', SERVICE: 'SERVICE', COMBO: 'COMBO' } as const

// finalPrice = basePrice * (1 + taxPercentage/100)
function finalPrice(basePrice: number, taxPercentage: number): number {
  return parseFloat((basePrice * (1 + taxPercentage / 100)).toFixed(2))
}

const demoProducts = [
  { barcode: '7460111111111', sku: 'REFIMP-0001', name: 'Refresco Imperio Rojo 500ml', slug: 'BEBIDAS', type: ProductType.PRODUCT, uom: 'Unidad', basePrice: 25, taxPercentage: 18, cost: 15, stock: 100, imageUrl: 'https://images.unsplash.com/photo-1622484214627-4474bfb984ba?w=200&h=200&fit=crop' },
  { barcode: '7460222222222', sku: 'SALIND-0002', name: 'Salami Super Especial Induveca', slug: 'ALIMENTOS', type: ProductType.PRODUCT, uom: 'Libra', basePrice: 150, taxPercentage: 18, cost: 110, stock: 50 },
  { barcode: '7460333333333', sku: 'RONBRU-0003', name: 'Ron Brugal Añejo 700ml', slug: 'BEBIDAS', type: ProductType.PRODUCT, uom: 'Unidad', basePrice: 550, taxPercentage: 18, cost: 400, stock: 20 },
  { barcode: '7460444444444', sku: 'JUGRIC-0004', name: 'Jugo Rica Naranja 1L', slug: 'BEBIDAS', type: ProductType.PRODUCT, uom: 'Unidad', basePrice: 80, taxPercentage: 18, cost: 60, stock: 40 },
  { barcode: '7460555555555', sku: 'CERPRE-0005', name: 'Cerveza Presidente Grande', slug: 'BEBIDAS', type: ProductType.PRODUCT, uom: 'Unidad', basePrice: 180, taxPercentage: 18, cost: 130, stock: 200 },
]

async function ensureDemoTenantData(tenantId: string) {
  const catMap: Record<string, string> = {}
  for (const c of categoryDefs) {
    const cat = await prisma.category.upsert({
      where: { slug_tenantId: { slug: c.slug, tenantId } },
      create: { ...c, tenantId },
      update: {},
    })
    catMap[c.slug] = cat.id
  }

  for (const p of demoProducts) {
    const { slug, ...rest } = p
    const price = finalPrice(rest.basePrice, rest.taxPercentage)
    const existingProduct = p.barcode
      ? await prisma.product.findUnique({ where: { barcode_tenantId: { barcode: p.barcode, tenantId } } })
      : null
    if (existingProduct) {
      await prisma.product.update({
        where: { id: existingProduct.id },
        data: {
          categoryId: catMap[slug],
          imageUrl: rest.imageUrl ?? existingProduct.imageUrl,
          sku: existingProduct.sku ?? rest.sku,
          type: rest.type,
          uom: rest.uom,
          basePrice: rest.basePrice,
          taxPercentage: rest.taxPercentage,
          taxType: 'ITBIS',
          price,
        },
      })
    } else {
      await prisma.product.create({
        data: {
          ...rest,
          taxType: 'ITBIS',
          price,
          categoryId: catMap[slug],
          tenantId,
        },
      })
    }
  }
  console.log('✅  Categories and demo products synced')
}

async function main() {
  console.log('🌱  Seeding database...')

  // Super Admin — Darío Betances
  const superEmail = 'dario@minimarket-os.com'
  const existingSuper = await prisma.user.findUnique({ where: { email: superEmail } })
  if (!existingSuper) {
    await prisma.user.create({
      data: {
        name: 'Darío Betances',
        username: 'dario',
        email: superEmail,
        password: hashPassword('superadmin2026'),
        role: Role.SUPER_ADMIN,
        tenantId: null,
      },
    })
    console.log('✅  SUPER_ADMIN: dario@minimarket-os.com / superadmin2026')
  } else {
    await prisma.user.update({
      where: { id: existingSuper.id },
      data: { username: 'dario' },
    })
    console.log('⚠️   SUPER_ADMIN already exists')
  }

  const existing = await prisma.tenant.findFirst({ where: { rnc: '123456789' } })
  if (existing) {
    console.log(`⚠️   Tenant already exists (id: ${existing.id}). Ensuring categories & product links…`)
    await prisma.user.updateMany({
      where: { tenantId: existing.id, email: 'admin@elprimo.com' },
      data: { username: 'admin' },
    })
    await prisma.user.updateMany({
      where: { tenantId: existing.id, email: 'cajero@elprimo.com' },
      data: { username: 'cajero' },
    })
    await ensureDemoTenantData(existing.id)
    console.log('\n🎉  Seed complete!')
    return
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Colmado El Primo',
      rnc: '123456789',
      phone: '809-555-1234',
      address: 'Calle Principal #1, Santo Domingo',
      isActive: true,
      plan: 'PREMIUM',
      expiresAt: defaultExpiry(),
    },
  })

  console.log(`✅  Tenant: ${tenant.name} (id: ${tenant.id})`)

  await prisma.user.createMany({
    data: [
      {
        name: 'Admin Principal',
        username: 'admin',
        email: 'admin@elprimo.com',
        password: hashPassword('admin123'),
        role: Role.ADMIN,
        tenantId: tenant.id,
      },
      {
        name: 'Cajero Demo',
        username: 'cajero',
        email: 'cajero@elprimo.com',
        password: hashPassword('cajero123'),
        role: Role.CASHIER,
        tenantId: tenant.id,
      },
    ],
  })
  console.log('✅  Users: admin / admin123, cajero / cajero123 (email login also supported)')

  await prisma.nCFSequence.createMany({
    data: [
      { tenantId: tenant.id, type: NcfType.CONSUMIDOR_FINAL, prefix: 'B02', nextValue: 1 },
      { tenantId: tenant.id, type: NcfType.CREDITO_FISCAL, prefix: 'B01', nextValue: 1 },
      { tenantId: tenant.id, type: NcfType.GUBERNAMENTAL, prefix: 'B15', nextValue: 1 },
      { tenantId: tenant.id, type: NcfType.REGISTRO_UNICO_INGRESO, prefix: 'B02', nextValue: 1 },
    ],
  })

  await ensureDemoTenantData(tenant.id)

  console.log('\n🎉  Seed complete!')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
