import * as THREE from "three";
import type { ThreadConfig } from "@/types/stamp";
import { createMaleThreadGeometry } from "./thread-geometry";

const HANDLE_COLOR = 0xd4a373;
const THREAD_COLOR = 0x8b5e3c;

export function createHandle(threadConfig: ThreadConfig): THREE.Group {
  const group = createHandleBody(threadConfig);

  const threadGeo = createMaleThreadGeometry(threadConfig);
  const threadMat = new THREE.MeshStandardMaterial({ color: THREAD_COLOR });
  const threadMesh = new THREE.Mesh(threadGeo, threadMat);
  group.add(threadMesh);

  return group;
}

export function createHandleBody(config: ThreadConfig): THREE.Group {
  const group = new THREE.Group();
  const bodyRadius = config.majorDiameter * 1.2;
  const bodyHeight = 18;
  const chamfer = 3;
  const mat = new THREE.MeshStandardMaterial({ color: HANDLE_COLOR });

  const bodyGeo = new THREE.CylinderGeometry(
    bodyRadius - chamfer, bodyRadius - chamfer, bodyHeight - chamfer * 2, 32,
  );
  const bodyMesh = new THREE.Mesh(bodyGeo, mat);
  bodyMesh.position.set(0, 0, config.height + bodyHeight / 2);
  bodyMesh.rotation.x = Math.PI / 2;
  group.add(bodyMesh);

  const bottomChamferGeo = new THREE.CylinderGeometry(
    bodyRadius - chamfer, bodyRadius * 0.5, chamfer, 32,
  );
  const bottomChamfer = new THREE.Mesh(bottomChamferGeo, mat);
  bottomChamfer.position.set(0, 0, config.height + chamfer / 2);
  bottomChamfer.rotation.x = Math.PI / 2;
  group.add(bottomChamfer);

  const topChamferGeo = new THREE.CylinderGeometry(
    bodyRadius * 0.5, bodyRadius - chamfer, chamfer, 32,
  );
  const topChamfer = new THREE.Mesh(topChamferGeo, mat);
  topChamfer.position.set(0, 0, config.height + bodyHeight - chamfer / 2);
  topChamfer.rotation.x = Math.PI / 2;
  group.add(topChamfer);

  return group;
}
