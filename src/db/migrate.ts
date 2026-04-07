import 'dotenv/config'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from './index.js'

const run = async () => {
  await migrate(db, { migrationsFolder: './drizzle/migrations' })
  console.log('Database migrations complete')
}

run().catch((error) => {
  console.error('Database migration failed', error)
  process.exit(1)
})