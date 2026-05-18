import * as THREE from "three";

export function exportSTL(mesh: THREE.Mesh | THREE.Group): Blob {
  const triangles: { vertices: THREE.Vector3[]; normal: THREE.Vector3 }[] = [];

  mesh.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geo = child.geometry;
    if (!geo) return;

    const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
    const positions = nonIndexed.getAttribute("position");

    for (let i = 0; i < positions.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(positions, i);
      const b = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);

      child.localToWorld(a);
      child.localToWorld(b);
      child.localToWorld(c);

      const edge1 = new THREE.Vector3().subVectors(b, a);
      const edge2 = new THREE.Vector3().subVectors(c, a);
      const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

      triangles.push({ vertices: [a, b, c], normal });
    }
  });

  const bufferSize = 84 + triangles.length * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // 80-byte header
  for (let i = 0; i < 80; i++) view.setUint8(i, 0);

  // Triangle count
  view.setUint32(80, triangles.length, true);

  let offset = 84;
  for (const tri of triangles) {
    view.setFloat32(offset, tri.normal.x, true); offset += 4;
    view.setFloat32(offset, tri.normal.y, true); offset += 4;
    view.setFloat32(offset, tri.normal.z, true); offset += 4;

    for (const v of tri.vertices) {
      view.setFloat32(offset, v.x, true); offset += 4;
      view.setFloat32(offset, v.y, true); offset += 4;
      view.setFloat32(offset, v.z, true); offset += 4;
    }

    // Attribute byte count
    view.setUint16(offset, 0, true); offset += 2;
  }

  return new Blob([buffer], { type: "application/octet-stream" });
}

export function downloadSTL(mesh: THREE.Mesh | THREE.Group, filename = "stamp.stl") {
  const blob = exportSTL(mesh);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
