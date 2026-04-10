# มาตรการรักษาความปลอดภัยของแอปพลิเคชัน & การชี้วัดตาม OWASP Top 10 (2025)

เอกสารฉบับนี้สรุปมาตรการความปลอดภัยของระบบจากซอร์สโค้ดจริง (Backend + Frontend) โดยจัดหมวดตามกรอบ OWASP Top 10 (2025) เพื่อประเมินทั้งระดับความพร้อมปัจจุบันและแนวทางพัฒนาต่อแบบ Defense-in-Depth

## สรุปภาพรวม

- ระบบใช้ JWT + Refresh Token พร้อม Redis สำหรับ revocation และ blacklist
- มี RBAC (`user`, `moderator`, `admin`) และตรวจสถานะบัญชี (`active`, `timed_out`, `banned`)
- มีการป้องกัน brute-force login, password hashing ด้วย Argon2, และตรวจรหัสผ่านรั่วไหล
- มี user/server logging ทั้งลงไฟล์แบบ rotate และลงฐานข้อมูล

---

## A01:2025 - Broken Access Control

### มาตรการที่มีอยู่

- Backend บังคับสิทธิ์ผ่าน middleware (`authMiddleware`, `authAdminMiddleware`) และเงื่อนไข role ในแต่ละ endpoint
- RBAC ถูกใช้จริงใน endpoint สำคัญ เช่นจัดการ role, users, logs
- มี object-level checks ในงานโพสต์ เช่นแก้ไข/ลบได้เฉพาะเจ้าของโพสต์หรือผู้มีสิทธิ์สูง
- มีการเพิกถอนสิทธิ์ token ระหว่าง logout (blacklist access token + ลบ refresh token jti)

---

## A02:2025 - Security Misconfiguration

### มาตรการที่มีอยู่

- มี schema validation ด้วย Zod (`zValidator`) ใน endpoint สำคัญ
- OAuth state/code_verifier ใช้ cookie แบบ `HttpOnly` และ `SameSite=Lax` (เปิด `secure` ใน production)
- API docs (`/scalar`) มี basic auth ป้องกันการเข้าถึงโดยไม่ตั้งใจ

---

## A03:2025 - Software Supply Chain Failures

### มาตรการที่มีอยู่

- มีไฟล์ config สำหรับ Sonar (`sonar-project.properties`) และมีแนวทางใช้ static analysis ในโครงการ
- โครงการมีโครงสร้างรองรับการรัน test และ lint/check เพิ่มเติม

---

## A04:2025 - Cryptographic Failures

### มาตรการที่มีอยู่

- รหัสผ่านใช้ Argon2 พร้อมพารามิเตอร์ที่ตั้งค่าเฉพาะ
- JWT เซ็นด้วย `HS256` และมีการกำหนดอายุ token ชัดเจน
- ตรวจรหัสผ่านรั่วไหลก่อนสมัครด้วยบริการ Have I Been Pwned

---

## A05:2025 - Injection

### มาตรการที่มีอยู่

- ใช้ Drizzle ORM ซึ่งลดความเสี่ยง SQL Injection จาก dynamic query string
- มีการ sanitize เนื้อหา post context ผ่าน `rehype-sanitize`
- มีการ validate อินพุตหลายจุดด้วย Zod

---

## A06:2025 - Insecure Design

### มาตรการที่มีอยู่

- มี account lockout: ล็อก 15 นาทีเมื่อ login fail ครบ threshold
- ค่าเริ่มต้น role ผู้ใช้ใหม่เป็น `user` (least privilege)
- มีสถานะบัญชี `timed_out` และ `banned` เพื่อลดความเสี่ยงจากบัญชีผิดปกติ

---

## A07:2025 - Authentication Failures

### มาตรการที่มีอยู่

- ใช้ access token อายุสั้น + refresh token อายุยาว
- มี refresh flow และ logout revocation ที่ตรวจสอบได้
- รองรับ Google OAuth พร้อม state verification
- รองรับ blocked flow เมื่อบัญชีถูก lock/banned

---

## A08:2025 - Software and Data Integrity Failures

### มาตรการที่มีอยู่

- JWT มีการ verify signature ทุกครั้งใน middleware
- Refresh token ผูกกับ Redis `jti` ช่วยป้องกัน token reuse บางรูปแบบ
- OAuth callback มีการตรวจ state เพื่อลดการสวมรอยข้าม session

---

## A09:2025 - Security Logging and Alerting Failures

### มาตรการที่มีอยู่

- มี logging หลายชั้น: console, rotate log files, และ database tables
- เก็บข้อมูลสำคัญของ interaction เช่น method/path/status/duration/ip/user-agent
- มี endpoint สำหรับตรวจสอบ logs โดย role ที่ได้รับอนุญาต

---

## A10:2025 - Mishandling of Exceptional Conditions

### มาตรการที่มีอยู่

- มีการจัดการ error ใน route handlers ด้วย `try/catch` และส่งข้อความทั่วไปกลับ client
- ลดการเปิดเผยรายละเอียดเชิงลึกของระบบใน response

---