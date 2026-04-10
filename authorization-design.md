# Authorization Design

## Overview

โปรเจกต์นี้ใช้การยืนยันตัวตนแบบ **JWT Bearer Token** ร่วมกับ **Refresh Token** และ **Role-Based Access Control (RBAC)**
โดย backend เป็นผู้ตรวจสอบสิทธิ์หลัก และ frontend ทำหน้าที่เก็บสถานะ session + แนบ Authorization header อัตโนมัติ

สถาปัตยกรรมปัจจุบันเป็นแนวทาง **token-based (header-driven)** ไม่ใช่ cookie session เต็มรูปแบบ
ยกเว้นเฉพาะขั้นตอน Google OAuth ที่ใช้ cookie ชั่วคราวสำหรับ `state` และ `code_verifier`

## Core Mechanisms

1. **Access Token + Refresh Token (JWT)**
   - ออก token ที่ backend (`/api/auth/login`, `/api/auth/register`, `/api/auth/google/callback`)
   - Access Token มีอายุสั้น `15m`
   - Refresh Token มีอายุ `7d`
   - ทั้งสอง token เซ็นด้วย `JWT_SECRET`
   - Refresh token จะมี `jti` และถูกผูกกับ Redis key (`refresh_token:{jti}`) เพื่อตรวจสอบความถูกต้องและเพิกถอนได้

2. **Token Lifecycle และ Revocation**
   - ตอน `logout` backend จะ blacklist access token ลง Redis (15 นาที) และลบ refresh token ตาม `jti`
   - `authMiddleware` จะตรวจว่า access token อยู่ใน blacklist หรือไม่ก่อนอนุญาต
   - เมื่อ access token หมดอายุ frontend จะเรียก `/api/auth/refresh` เพื่อขอ access token ใหม่ด้วย refresh token เดิม

3. **Role-Based Access Control (RBAC)**
   - Roles หลัก: `user`, `moderator`, `admin`
   - ตรวจสิทธิ์ระดับ endpoint ผ่าน middleware และเงื่อนไขใน route:
     - `authMiddleware`: ต้องมี token ที่ valid
     - `authAdminMiddleware`: อนุญาตเฉพาะ `moderator` หรือ `admin`
     - บาง endpoint บังคับ `admin` เท่านั้นด้วยเงื่อนไขใน handler (เช่น `/api/roles` PUT)

4. **Account State Enforcement**
   - User status: `active`, `timed_out`, `banned`
   - หาก `banned` จะถูกบล็อกจาก middleware ทันที
   - หาก `timed_out` จะถูกบล็อกการกระทำสำคัญหลายจุด (เช่น create/update/like/dislike post)
   - มี logic auto-clear timeout เมื่อถึงเวลา (`timeoutEnd`)

5. **Login Protection (Rate Limiting / Lockout)**
   - หลัง login fail จะนับด้วย Redis (`auth:login:failures:{hash(email)}`)
   - เกิน threshold จะ lock (`auth:login:lock:{hash(email)}`)
   - ค่าคอนฟิกหลัก:
     - Max attempts: `5`
     - Sliding window: `15 นาที`
     - Lock duration: `15 นาที`

6. **Password Security**
   - Hash ด้วย Argon2 (memory/time cost กำหนดใน constants)
   - บังคับความยาวขั้นต่ำรหัสผ่าน `15` ตัวอักษรตอน register
   - ตรวจรหัสผ่านที่รั่วผ่าน Have I Been Pwned API (`pwnedpasswords`) ก่อนสมัคร

7. **Google OAuth Integration**
   - เริ่ม flow ที่ `/api/auth/google`
   - ใช้ cookie `google_oauth_state` และ `google_code_verifier` (HttpOnly, SameSite=Lax, Secure ใน production)
   - callback ที่ `/api/auth/google/callback` จะสร้าง/ผูก user แล้ว redirect ไป frontend:
     - `/auth-success?token=...&refreshToken=...`
   - หน้า frontend `/auth-success` จะอ่าน query token แล้วผูกเข้า auth store

8. **Frontend Session Model**
   - ใช้ Zustand (`persist`) เก็บ `accessToken`, `refreshToken`, `user`, `isAuthenticated`
   - ใช้ `Authorization: Bearer <token>` ทุก request ที่ต้อง auth
   - มี auto-refresh middleware ใน API client:
     - ถ้าเจอ `401` จะ refresh token 1 ครั้ง
     - refresh สำเร็จจะ retry request เดิม
     - refresh ไม่สำเร็จจะ logout

## Endpoint Protections

### Public Endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/google`
- `GET /api/auth/google/callback`
- `POST /api/auth/refresh`
- `GET /api/posts` (guest ได้, ข้อมูลขึ้นกับ role)
- `GET /api/posts/:id` (guest ได้เฉพาะโพสต์ public)

### Authenticated Endpoints (Bearer Token)

- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/account`
- `PUT /api/account`
- `POST /api/posts`
- `GET /api/posts/@me`
- `PUT /api/posts/:id`
- `PUT /api/posts/like/:id`
- `DELETE /api/posts/:id`
- `PATCH /api/posts/:id/restore`

### Privileged Endpoints

- `PUT /api/account/ban`: `admin` เท่านั้น
- `PUT /api/roles`: `admin` เท่านั้น (ห้ามแก้ role ตัวเอง/ห้ามแก้ admin)
- `/api/users/*`: `admin` หรือ `moderator`
- `/api/logs/*`: `admin` หรือ `moderator` 

## Frontend Route Guarding

1. **UI-level role gating**
   - เมนู/ทางเข้า admin แสดงเฉพาะผู้ใช้ role `admin`
   - เมนู moderator แสดงเฉพาะ `moderator` หรือ `admin`

2. **Page-level guard**
   - หน้า `/admin/*` ตรวจทั้ง `isAuthenticated` และ `user.role === 'admin'`
   - หน้า account/my-posts ตรวจว่าล็อกอินแล้วก่อนเข้าถึง

3. **Note**
   - frontend guard เป็น UX layer เท่านั้น

## Security Considerations

1. **Strengths ที่มีอยู่ในโค้ด**
   - JWT อายุสั้น + refresh flow
   - Redis-based token revocation (blacklist + jti store)
   - Rate limiting และ lockout ตอน login
   - Argon2 + breached password check
   - Role และ status checks ครอบคลุมหลาย endpoint

2. **ข้อควรระวัง/ข้อเสนอแนะ**
   - OAuth callback ส่ง token ผ่าน query string (`/auth-success?token=...`) ซึ่งมีความเสี่ยงด้านการรั่วใน logs/history/referrer
   - frontend เก็บ token แบบ persisted store (ฝั่ง browser) ต้องระวัง XSS
   - CORS ตอนนี้ตั้ง `origin: '*'` พร้อม `credentials: true` ควรจำกัด origin ใน production

## Summary

ระบบ Authorization ปัจจุบันเป็น **JWT + Refresh + Redis Revocation + RBAC** ที่ใช้งานได้จริงทั้ง backend/frontend
โดย backend รับผิดชอบการตัดสินสิทธิ์เป็นหลัก และ frontend เสริมด้วย state/session management และ route gating เพื่อประสบการณ์ใช้งานที่ดี
