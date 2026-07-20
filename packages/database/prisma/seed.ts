import { PrismaClient, NcfType, Role } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:admin@localhost:5433/minimarket'
const pool = new pg.Pool({ connectionString: DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱  Seeding database...')

  const existing = await prisma.tenant.findFirst({ where: { rnc: '123456789' } })
  if (existing) {
    console.log(`⚠️   Tenant already seeded (id: ${existing.id}). Skipping.`)
    console.log(`\n    🔑  NEXT_PUBLIC_TENANT_ID=${existing.id}\n`)
    return
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Colmado El Primo',
      rnc: '123456789',
      phone: '809-555-1234',
      address: 'Calle Principal #1, Santo Domingo',
    },
  })

  console.log(`✅  Tenant: ${tenant.name} (id: ${tenant.id})`)
  console.log(`\n    🔑  Copy this TENANT_ID for the frontend:`)
  console.log(`    NEXT_PUBLIC_TENANT_ID=${tenant.id}\n`)

  await prisma.user.create({
    data: {
      name: 'Admin Principal',
      email: 'admin@elprimo.com',
      password: 'plaintext_for_dev_only', // Use bcrypt in production
      role: Role.ADMIN,
      tenantId: tenant.id,
    },
  })

  await prisma.nCFSequence.createMany({
    data: [
      { tenantId: tenant.id, type: NcfType.CONSUMIDOR_FINAL, prefix: 'B02', nextValue: 1 },
      { tenantId: tenant.id, type: NcfType.CREDITO_FISCAL,   prefix: 'B01', nextValue: 1 },
      { tenantId: tenant.id, type: NcfType.GUBERNAMENTAL,    prefix: 'B15', nextValue: 1 },
    ],
  })
  console.log('✅  NCF sequences: B01, B02, B15')

  const products = [
    { barcode: '7460111111111', name: 'Refresco Imperio Rojo 500ml',    category: 'Bebidas',   price: 25,  cost: 15,  stock: 100 },
    { barcode: '7460222222222', name: 'Salami Super Especial Induveca', category: 'Embutidos', price: 150, cost: 110, stock: 50  },
    { barcode: '7460333333333', name: 'Ron Brugal Añejo 700ml',         category: 'Licores',   price: 550, cost: 400, stock: 20  },
    { barcode: '7460444444444', name: 'Jugo Rica Naranja 1L',           category: 'Bebidas',   price: 80,  cost: 60,  stock: 40  },
    { barcode: '7460555555555', name: 'Cerveza Presidente Grande',      category: 'Bebidas',   price: 180, cost: 130, stock: 200 },
  ]

  for (const p of products) {
    await prisma.product.create({ data: { ...p, tenantId: tenant.id } })
    console.log(`   📦  ${p.name}`)
  }

  console.log('\n🎉  Seed complete!')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
