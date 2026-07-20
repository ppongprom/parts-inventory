"use client";

import { getChildren } from "../lib/zoneHelpers";

/**
 * โหนดเดียวของ tree โซนจัดเก็บ เรียกตัวเองซ้ำ (recursive) เพื่อ render ลูกหลาน
 * ฟอร์ม add/edit ให้ parent (page) เป็นคนคุม state ทั้งหมด — ส่ง renderAddForm/renderEditForm
 * เป็น render-prop function ลงมา เพื่อไม่ต้องส่ง props ย่อยเป็นสิบตัวไล่ลงมาทุกชั้น
 */
export default function ZoneTreeNode({
  zone,
  zones,
  depth,
  expandedIds,
  onToggleExpand,
  editingZoneId,
  addingUnderId,
  onStartEdit,
  onStartAdd,
  onDelete,
  renderEditForm,
  renderAddForm,
  ownerTypeLabels,
}) {
  const children = getChildren(zones, zone.id);
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(zone.id);

  if (editingZoneId === zone.id) {
    return <div style={{ marginLeft: depth * 20 }}>{renderEditForm(zone)}</div>;
  }

  return (
    <div>
      <div
        className="card"
        style={{ marginLeft: depth * 20, cursor: "default", alignItems: "center", justifyContent: "space-between" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => hasChildren && onToggleExpand(zone.id)}
            disabled={!hasChildren}
            style={{
              background: "none",
              border: "none",
              cursor: hasChildren ? "pointer" : "default",
              fontSize: 14,
              width: 20,
              flexShrink: 0,
              color: hasChildren ? "var(--text)" : "var(--text-muted)",
              padding: 0,
            }}
            aria-label={hasChildren ? (isExpanded ? "ย่อ" : "ขยาย") : undefined}
          >
            {hasChildren ? (isExpanded ? "▾" : "▸") : "•"}
          </button>
          <div className="card-body" style={{ minWidth: 0 }}>
            <div className="card-title">
              {zone.code}
              {hasChildren && (
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}> ({children.length} โซนย่อย)</span>
              )}
            </div>
            <div className="card-sub">
              {zone.name && <>{zone.name} · </>}
              {ownerTypeLabels[zone.owner_type] || zone.owner_type}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => onStartAdd(zone.id)}
            title="เพิ่มโซนย่อยในนี้"
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: "transparent",
              color: "var(--text)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            + ย่อย
          </button>
          <button
            type="button"
            onClick={() => onStartEdit(zone)}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: "transparent",
              color: "var(--text)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            แก้ไข
          </button>
          <button
            type="button"
            onClick={() => onDelete(zone)}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--danger-border)",
              background: "transparent",
              color: "var(--danger-text)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            ลบ
          </button>
        </div>
      </div>

      {addingUnderId === zone.id && (
        <div style={{ marginLeft: (depth + 1) * 20 }}>{renderAddForm(zone.id)}</div>
      )}

      {isExpanded &&
        children.map((child) => (
          <ZoneTreeNode
            key={child.id}
            zone={child}
            zones={zones}
            depth={depth + 1}
            expandedIds={expandedIds}
            onToggleExpand={onToggleExpand}
            editingZoneId={editingZoneId}
            addingUnderId={addingUnderId}
            onStartEdit={onStartEdit}
            onStartAdd={onStartAdd}
            onDelete={onDelete}
            renderEditForm={renderEditForm}
            renderAddForm={renderAddForm}
            ownerTypeLabels={ownerTypeLabels}
          />
        ))}
    </div>
  );
}
