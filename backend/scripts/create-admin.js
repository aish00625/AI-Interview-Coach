
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const bcrypt = require('bcryptjs')
const readline = require('readline/promises')
const { stdin, stdout } = require('process')
const { pool } = require('../config/db')

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout })

  try {
    const email = (await rl.question('Admin email: ')).trim().toLowerCase()
    const name = (await rl.question('Admin name: ')).trim()
    const password = await rl.question('Choose admin password: ')

    if (!email || !name || password.length < 8) {
      throw new Error('Email and name are required; password must be at least 8 characters.')
    }

    const existing = await pool.query(
      'SELECT id, role FROM users WHERE email = $1',
      [email]
    )

    if (existing.rowCount) {
      throw new Error('That email already exists. No account was changed.')
    }

    const passwordHash = await bcrypt.hash(password, 10)

    await pool.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, 'admin')`,
      [email, passwordHash, name]
    )

    console.log('Admin account created successfully.')
    console.log(`Email: ${email}`)
  } finally {
    rl.close()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('Admin setup failed:', err.message)
  process.exitCode = 1
})
