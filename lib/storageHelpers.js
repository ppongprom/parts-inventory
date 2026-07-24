import { supabase } from "./supabaseClient";

const BUCKET = "part-photos";

export async function uploadPartPhoto(file) {
  const fileExt = file.name.split(".").pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

  const { error } = await supabase.storage.from(BUCKET).upload(fileName, file);
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

export async function uploadPartPhotos(files) {
  const urls = [];
  for (const file of files) {
    const url = await uploadPartPhoto(file);
    urls.push(url);
  }
  return urls;
}

// ใช้ bucket เดียวกับอะไหล่ แค่ prefix ชื่อไฟล์ต่างกัน (ไม่ต้องสร้าง bucket ใหม่)
export async function uploadJobPhoto(file) {
  const fileExt = file.name.split(".").pop();
  const fileName = `job-${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

  const { error } = await supabase.storage.from(BUCKET).upload(fileName, file);
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

export async function uploadJobPhotos(files) {
  const urls = [];
  for (const file of files) {
    const url = await uploadJobPhoto(file);
    urls.push(url);
  }
  return urls;
}

// รูปหลักฐานต่อขั้นตอนงาน (job_step_photos) — ใช้ bucket เดียวกัน แค่ prefix ต่างกันอีกชั้น
// เผื่อไล่ดูใน storage bucket ตรงๆ ได้ว่าไฟล์ไหนเป็นของ step ไหน/หมวดอะไร
export async function uploadJobStepPhoto(file, stepId, category) {
  const fileExt = file.name.split(".").pop();
  const fileName = `job-step-${stepId}-${category}-${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

  const { error } = await supabase.storage.from(BUCKET).upload(fileName, file);
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

export async function uploadJobStepPhotos(files, stepId, category) {
  const urls = [];
  for (const file of files) {
    const url = await uploadJobStepPhoto(file, stepId, category);
    urls.push(url);
  }
  return urls;
}

function extractStoragePath(url) {
  const marker = `/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

export async function deletePartPhotoByUrl(url) {
  const path = extractStoragePath(url);
  if (!path) return;
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    // best-effort — ไม่ block flow หลักถ้าลบไฟล์ใน storage ไม่สำเร็จ
  }
}

export async function deletePartPhotos(urls) {
  await Promise.all((urls || []).filter(Boolean).map((u) => deletePartPhotoByUrl(u)));
}
