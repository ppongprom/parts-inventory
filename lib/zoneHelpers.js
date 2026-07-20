// Helper functions for the Area/Rack/Level location hierarchy.
// zones แต่ละแถวมี: id, parent_id (null = root/Area), code, name, path (ltree เป็น text), owner_type

/** ลูกโดยตรงของ parentId (parentId = null คือระดับบนสุด/Area) */
export function getChildren(zones, parentId) {
  return zones
    .filter((z) => (z.parent_id || null) === (parentId || null))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** true ถ้า zone นี้ไม่มีลูกเลย (เป็น leaf — จุดที่เลือกได้จริงสำหรับ /add, /edit) */
export function isLeaf(zones, zoneId) {
  return !zones.some((z) => z.parent_id === zoneId);
}

/** ไล่ทวนจาก zoneId กลับขึ้นไปหา root คืนเป็น array [root, ..., self] */
export function getAncestorChain(zones, zoneId) {
  const chain = [];
  let current = zones.find((z) => z.id === zoneId);
  while (current) {
    chain.unshift(current);
    current = current.parent_id ? zones.find((z) => z.id === current.parent_id) : null;
  }
  return chain;
}

/** breadcrumb string เช่น "A1 > Rack 2 > Level 3" */
export function formatBreadcrumb(zones, zoneId) {
  return getAncestorChain(zones, zoneId)
    .map((z) => z.code)
    .join(" › ");
}

/** ลูกหลานทั้งหมด (รวมตัวเอง) ของ zoneId — ใช้กรองอะไหล่ทั้งหมดใต้ Area นี้ */
export function getDescendantIds(zones, zoneId) {
  const result = [zoneId];
  const stack = [zoneId];
  while (stack.length) {
    const id = stack.pop();
    for (const z of zones) {
      if (z.parent_id === id) {
        result.push(z.id);
        stack.push(z.id);
      }
    }
  }
  return result;
}

/** zones ทั้งหมดที่ไม่มีลูก — ใช้เป็นรายการ "เลือกได้จริง" แบบเรียบ (ไม่ผ่าน cascade) ถ้าต้องการ */
export function getLeafZones(zones) {
  return zones.filter((z) => isLeaf(zones, z.id));
}
