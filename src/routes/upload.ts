import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth.js'
import type { Variables } from '../middleware/auth.js'
import { serverLogger } from '../utils/logger.js'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

const uploadAPI = new Hono<{ Variables: Variables }>()

const UPLOADS_DIR = path.join(process.cwd(), 'uploads')
const BANNERS_DIR = path.join(UPLOADS_DIR, 'banners')
const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars')

// Ensure uploads directories exist securely
;[UPLOADS_DIR, BANNERS_DIR, AVATARS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
})

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB limit
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']

uploadAPI.post('/:type', authMiddleware, async (c) => {
  try {
    const type = c.req.param('type')
    if (type !== 'banner' && type !== 'avatar') {
      return c.json({ error: 'Invalid upload type. Must be banner or avatar.' }, 400)
    }

    const body = await c.req.parseBody()
    const file = body['file']

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file uploaded or invalid file type.' }, 400)
    }

    if (file.size > MAX_FILE_SIZE) {
      return c.json({ error: 'File size exceeds the 5MB limit.' }, 400)
    }
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return c.json({ error: 'Invalid file type. Only JPEG, PNG, and WEBP are allowed.' }, 400)
    }

    const originalExt = path.extname(file.name).toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(originalExt)) {
      return c.json({ error: 'Invalid file extension.' }, 400)
    }

    const randomName = crypto.randomUUID() + originalExt
    
    // Choose correct directory based on type
    const targetDir = type === 'banner' ? BANNERS_DIR : AVATARS_DIR
    const savePath = path.join(targetDir, randomName)

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    await fs.promises.writeFile(savePath, buffer)

    return c.json({ 
      message: 'File uploaded successfully',
      url: `/uploads/${type}s/${randomName}` 
    }, 201)

  } catch (error) {
    serverLogger.error('File upload error:', { error })
    return c.json({ error: 'Failed to upload file. Please try again.' }, 500)
  }
})

export default uploadAPI
