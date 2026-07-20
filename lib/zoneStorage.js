// เก็บ zone_id (leaf) ที่ใช้ล่าสุด — เปลี่ยนจากเก็บ zone_code (text) เดิม เพราะย้ายไปใช้
// zone_id (FK → zones.id) แล้วตาม location hierarchy migration
const KEY = "parts_inventory_default_zone_id";

export function getDefaultZone() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function setDefaultZone(zoneId) {
  if (typeof window === "undefined") return;
  try {
    if (zoneId) {
      window.localStorage.setItem(KEY, zoneId);
    } else {
      window.localStorage.removeItem(KEY);
    }
  } catch {
    // ignore (private mode / storage disabled)
  }
}
