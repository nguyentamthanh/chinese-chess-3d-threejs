import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/addons/controls/OrbitControls.js";
import { GLTFLoader } from "./vendor/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "./vendor/addons/utils/SkeletonUtils.js";

const boardConfig = {
  files: 9,
  ranks: 10,
  spacing: 2.25,
  boardThickness: 1.1,
};

const pieceLabels = {
  general: "Tướng",
  advisor: "Sĩ",
  elephant: "Tượng",
  rook: "Xe",
  cannon: "Pháo",
  horse: "Mã",
  soldier: "Tốt",
};

const pieceValues = {
  general: 1000,
  advisor: 2,
  elephant: 2,
  rook: 9,
  cannon: 5,
  horse: 4,
  soldier: 1,
};

const sideLabels = {
  red: "Đỏ",
  black: "Đen",
};

const selectedDom = document.getElementById("selected-piece");
const modeDom = document.getElementById("game-mode");
const modeTextDom = document.getElementById("mode-text");
const turnTextDom = document.getElementById("turn-text");
const statusTextDom = document.getElementById("status-text");
const newGameButton = document.getElementById("new-game-btn");
const canvas = document.getElementById("scene");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120f0c);
scene.fog = new THREE.Fog(0x120f0c, 32, 56);

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 160);
camera.position.set(0, 24, 28);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0.9, 0);
controls.minDistance = 16;
controls.maxDistance = 56;
controls.maxPolarAngle = Math.PI * 0.48;

const hemi = new THREE.HemisphereLight(0xfff2d8, 0x3c3329, 0.6);
scene.add(hemi);

const keyLight = new THREE.DirectionalLight(0xfff0dd, 1.2);
keyLight.position.set(16, 24, 12);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -24;
keyLight.shadow.camera.right = 24;
keyLight.shadow.camera.top = 24;
keyLight.shadow.camera.bottom = -24;
keyLight.shadow.camera.near = 2;
keyLight.shadow.camera.far = 70;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x95a6ff, 0.28);
rimLight.position.set(-18, 13, -18);
scene.add(rimLight);

const boardTopY = boardConfig.boardThickness * 0.5;
const boardPickY = boardTopY + 0.24;
const boardRayPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -boardPickY);

const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xf0c9a0, roughness: 0.6, metalness: 0.05 });
const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1512, roughness: 0.7, metalness: 0.1 });
const steelMaterial = new THREE.MeshStandardMaterial({ color: 0xc9d0d8, roughness: 0.25, metalness: 0.85 });

const moveEffects = [];
const cameraShake = { until: 0, strength: 0 };
const characterModels = {};
const characterMixers = [];

const pieces = [];
const pickTargets = [];
const boardMap = new Map();
const riverRipples = [];
const riverFlowTracks = [];
let riverSurfaceMaterial = null;

const humanSide = "red";
const aiSide = "black";

const gameState = {
  mode: modeDom.value,
  currentSide: "red",
  selectedPiece: null,
  winner: null,
  aiTimer: null,
};

const root = new THREE.Group();
scene.add(root);

createGround();
createBoard();

const selectionRing = new THREE.Mesh(
  new THREE.TorusGeometry(1.05, 0.065, 16, 54),
  new THREE.MeshStandardMaterial({
    color: 0xffd27a,
    emissive: 0x7a4f00,
    emissiveIntensity: 0.68,
    metalness: 0.4,
    roughness: 0.3,
  }),
);
selectionRing.rotation.x = Math.PI * 0.5;
selectionRing.position.y = boardTopY + 0.11;
selectionRing.visible = false;
root.add(selectionRing);

const moveHintGroup = new THREE.Group();
root.add(moveHintGroup);
const captureGlowPieces = new Set();

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

renderer.domElement.addEventListener("pointerdown", onPointerDown);
window.addEventListener("resize", onResize);
modeDom.addEventListener("change", onModeChange);
newGameButton.addEventListener("click", () => resetGame("Đã bắt đầu ván mới."));

await loadCharacterModels();
resetGame("Sẵn sàng bắt đầu ván cờ.");

const clock = new THREE.Clock();
let lastTime = 0;
animate();

function createGround() {
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(35, 38, 1.8, 72),
    new THREE.MeshStandardMaterial({ color: 0x2a241f, roughness: 0.9, metalness: 0.06 }),
  );
  floor.position.y = -1.3;
  floor.receiveShadow = true;
  root.add(floor);

  const glow = new THREE.Mesh(
    new THREE.RingGeometry(26, 33, 80),
    new THREE.MeshBasicMaterial({ color: 0x9d5f2f, transparent: true, opacity: 0.08, side: THREE.DoubleSide }),
  );
  glow.rotation.x = -Math.PI * 0.5;
  glow.position.y = -0.39;
  root.add(glow);
}

function createBoard() {
  const boardWidth = (boardConfig.files - 1) * boardConfig.spacing;
  const boardDepth = (boardConfig.ranks - 1) * boardConfig.spacing;
  const riverGap = boardConfig.spacing * 1.08;
  const halfDepth = (boardDepth - riverGap) * 0.5;

  const border = new THREE.Mesh(
    new THREE.BoxGeometry(boardWidth + 3.8, boardConfig.boardThickness, boardDepth + 3.8),
    new THREE.MeshStandardMaterial({ color: 0x654633, roughness: 0.78, metalness: 0.06 }),
  );
  border.position.y = 0;
  border.castShadow = true;
  border.receiveShadow = true;
  root.add(border);

  const boardTopMat = new THREE.MeshStandardMaterial({ color: 0xbf9568, roughness: 0.72, metalness: 0.04 });
  const topNorth = new THREE.Mesh(new THREE.BoxGeometry(boardWidth, 0.22, halfDepth), boardTopMat);
  topNorth.position.set(0, boardTopY + 0.12, riverGap * 0.5 + halfDepth * 0.5);
  topNorth.receiveShadow = true;
  root.add(topNorth);

  const topSouth = topNorth.clone();
  topSouth.position.z = -topNorth.position.z;
  root.add(topSouth);

  const riverBed = new THREE.Mesh(
    new THREE.BoxGeometry(boardWidth - 0.1, 0.08, riverGap + 0.18),
    new THREE.MeshStandardMaterial({ color: 0x2d4f66, roughness: 0.56, metalness: 0.2 }),
  );
  riverBed.position.y = boardTopY + 0.09;
  root.add(riverBed);

  const riverMat = new THREE.MeshStandardMaterial({
    color: 0x5a9fcd,
    transparent: true,
    opacity: 0.58,
    roughness: 0.3,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });
  riverSurfaceMaterial = riverMat;

  const river = new THREE.Mesh(new THREE.PlaneGeometry(boardWidth - 0.2, riverGap + 0.02), riverMat);
  river.rotation.x = -Math.PI * 0.5;
  river.position.y = boardTopY + 0.155;
  root.add(river);

  const flowTexA = createWaterFlowTexture("#d6f2ff");
  flowTexA.wrapS = THREE.RepeatWrapping;
  flowTexA.wrapT = THREE.RepeatWrapping;
  flowTexA.repeat.set(3.2, 1.15);
  flowTexA.colorSpace = THREE.SRGBColorSpace;
  flowTexA.anisotropy = 4;

  const flowTexB = createWaterFlowTexture("#b8e8ff");
  flowTexB.wrapS = THREE.RepeatWrapping;
  flowTexB.wrapT = THREE.RepeatWrapping;
  flowTexB.repeat.set(2.2, 0.95);
  flowTexB.colorSpace = THREE.SRGBColorSpace;
  flowTexB.anisotropy = 4;

  riverFlowTracks.push({ texture: flowTexA, speed: 0.12, direction: 1, wobble: 0.01 });
  riverFlowTracks.push({ texture: flowTexB, speed: 0.07, direction: -1, wobble: 0.013 });

  const flowLayerA = new THREE.Mesh(
    new THREE.PlaneGeometry(boardWidth - 0.45, riverGap - 0.16),
    new THREE.MeshBasicMaterial({
      map: flowTexA,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  flowLayerA.rotation.x = -Math.PI * 0.5;
  flowLayerA.position.y = boardTopY + 0.165;
  root.add(flowLayerA);

  const flowLayerB = new THREE.Mesh(
    new THREE.PlaneGeometry(boardWidth - 0.7, riverGap - 0.27),
    new THREE.MeshBasicMaterial({
      map: flowTexB,
      transparent: true,
      opacity: 0.21,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  flowLayerB.rotation.x = -Math.PI * 0.5;
  flowLayerB.rotation.z = Math.PI * 0.02;
  flowLayerB.position.y = boardTopY + 0.169;
  root.add(flowLayerB);

  const rippleMat = new THREE.MeshBasicMaterial({
    color: 0xd6efff,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
  });
  for (let i = -2; i <= 2; i += 1) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(boardWidth - 0.8, 0.1), rippleMat);
    stripe.rotation.x = -Math.PI * 0.5;
    stripe.position.set(0, boardTopY + 0.16, i * 0.35);
    stripe.userData = {
      phase: (i + 2) * 0.8,
      baseX: 0,
      baseZ: i * 0.35,
      swayX: 0.22 + Math.abs(i) * 0.09,
    };
    riverRipples.push(stripe);
    root.add(stripe);
  }

  const riverEdgeMat = new THREE.MeshStandardMaterial({ color: 0x85633f, roughness: 0.5, metalness: 0.18 });
  const riverEdge1 = new THREE.Mesh(new THREE.BoxGeometry(boardWidth - 0.12, 0.12, 0.12), riverEdgeMat);
  const riverEdge2 = riverEdge1.clone();
  riverEdge1.position.set(0, boardTopY + 0.15, riverGap * 0.5);
  riverEdge2.position.set(0, boardTopY + 0.15, -riverGap * 0.5);
  root.add(riverEdge1, riverEdge2);

  const lineMat = new THREE.MeshStandardMaterial({
    color: 0x2b1205,
    emissive: 0x1b0902,
    emissiveIntensity: 0.25,
    roughness: 0.28,
    metalness: 0.18,
  });

  for (let rank = 0; rank < boardConfig.ranks; rank += 1) {
    const a = boardToWorld(0, rank);
    const b = boardToWorld(8, rank);
    addBoardSegment(a.x, a.z, b.x, b.z, lineMat);
  }

  for (let file = 0; file < boardConfig.files; file += 1) {
    const lowA = boardToWorld(file, 0);
    const lowB = boardToWorld(file, 4);
    addBoardSegment(lowA.x, lowA.z, lowB.x, lowB.z, lineMat);

    const highA = boardToWorld(file, 5);
    const highB = boardToWorld(file, 9);
    addBoardSegment(highA.x, highA.z, highB.x, highB.z, lineMat);
  }

  addPalaceLines(lineMat, 0);
  addPalaceLines(lineMat, 7);

  const starPoints = [
    [1, 2],
    [7, 2],
    [1, 7],
    [7, 7],
    [0, 3],
    [2, 3],
    [4, 3],
    [6, 3],
    [8, 3],
    [0, 6],
    [2, 6],
    [4, 6],
    [6, 6],
    [8, 6],
  ];

  const starMat = new THREE.MeshStandardMaterial({ color: 0x3f2817, roughness: 0.36, metalness: 0.3 });
  starPoints.forEach(([file, rank]) => {
    const pos = boardToWorld(file, rank);
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.018, 14), starMat);
    marker.position.set(pos.x, boardTopY + 0.236, pos.z);
    root.add(marker);
  });
}

function addPalaceLines(lineMat, rankStart) {
  const a = boardToWorld(3, rankStart);
  const b = boardToWorld(5, rankStart + 2);
  const c = boardToWorld(5, rankStart);
  const d = boardToWorld(3, rankStart + 2);
  addBoardSegment(a.x, a.z, b.x, b.z, lineMat);
  addBoardSegment(c.x, c.z, d.x, d.z, lineMat);
}

function addBoardSegment(x1, z1, x2, z2, mat) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);

  const segment = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, length), mat);
  segment.position.set((x1 + x2) * 0.5, boardTopY + 0.236, (z1 + z2) * 0.5);
  segment.rotation.y = Math.atan2(dx, dz);
  root.add(segment);
}

function createWaterFlowTexture(lineColor) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.needsUpdate = true;
    return fallback;
  }

  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.08)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.22;
  for (let i = -3; i < 11; i += 1) {
    const y = i * 28;
    ctx.beginPath();
    ctx.moveTo(0, y + 10);
    ctx.bezierCurveTo(canvas.width * 0.2, y - 8, canvas.width * 0.46, y + 24, canvas.width * 0.7, y + 2);
    ctx.bezierCurveTo(canvas.width * 0.82, y - 8, canvas.width * 0.92, y + 22, canvas.width, y + 8);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.48)";
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.35;
  for (let i = -2; i < 12; i += 1) {
    const y = i * 24;
    ctx.beginPath();
    ctx.moveTo(0, y + 3);
    ctx.quadraticCurveTo(canvas.width * 0.5, y + 13, canvas.width, y + 2);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function onModeChange() {
  gameState.mode = modeDom.value;
  resetGame("Đã đổi chế độ chơi.");
}

function resetGame(message = "") {
  clearTimeout(gameState.aiTimer);
  gameState.aiTimer = null;
  gameState.selectedPiece = null;
  gameState.winner = null;
  gameState.currentSide = "red";

  clearSelection();
  clearMoveHints();
  clearPieces();
  createAllPieces();
  updateHudStatus(message || "Ván mới đã sẵn sàng.");
  scheduleAiMoveIfNeeded();
}

function clearPieces() {
  moveEffects.forEach((fx) => {
    if (fx.object) root.remove(fx.object);
  });
  moveEffects.length = 0;
  pieces.forEach((piece) => {
    root.remove(piece);
  });
  pieces.length = 0;
  pickTargets.length = 0;
  boardMap.clear();
}

function createAllPieces() {
  const setup = [];
  pushBackRank(setup, "red", 0);
  pushCannons(setup, "red", 2);
  pushSoldiers(setup, "red", 3);

  pushBackRank(setup, "black", 9);
  pushCannons(setup, "black", 7);
  pushSoldiers(setup, "black", 6);

  setup.forEach((item, idx) => {
    const piece = createPiece(item.type, item.side);
    const pos = boardToWorld(item.file, item.rank);
    piece.position.set(pos.x, boardTopY + 0.14, pos.z);

    piece.userData = {
      id: `${item.side}-${item.type}-${idx}`,
      ...item,
      captured: false,
      bobSeed: idx * 0.41,
      bobAmp: 0.04 + (idx % 4) * 0.007,
      baseY: boardTopY + 0.14,
      baseScale: piece.scale.clone(),
    };

    piece.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    root.add(piece);
    pieces.push(piece);
    pickTargets.push(piece);
    boardMap.set(squareKey(item.file, item.rank), piece);
  });
}

function pushBackRank(list, side, rank) {
  list.push({ type: "rook", side, file: 0, rank });
  list.push({ type: "horse", side, file: 1, rank });
  list.push({ type: "elephant", side, file: 2, rank });
  list.push({ type: "advisor", side, file: 3, rank });
  list.push({ type: "general", side, file: 4, rank });
  list.push({ type: "advisor", side, file: 5, rank });
  list.push({ type: "elephant", side, file: 6, rank });
  list.push({ type: "horse", side, file: 7, rank });
  list.push({ type: "rook", side, file: 8, rank });
}

function pushCannons(list, side, rank) {
  list.push({ type: "cannon", side, file: 1, rank });
  list.push({ type: "cannon", side, file: 7, rank });
}

function pushSoldiers(list, side, rank) {
  [0, 2, 4, 6, 8].forEach((file) => list.push({ type: "soldier", side, file, rank }));
}

function boardToWorld(file, rank) {
  const x = (file - 4) * boardConfig.spacing;
  const z = (4.5 - rank) * boardConfig.spacing;
  return { x, z };
}

function worldToBoard(x, z) {
  const file = Math.round(x / boardConfig.spacing + 4);
  const rank = Math.round(4.5 - z / boardConfig.spacing);
  return { file, rank };
}

function createPiece(type, side) {
  const group = new THREE.Group();
  const palette = buildPalette(side);
  group.userData.side = side;

  createPedestal(group, palette, 1);

  const figure = new THREE.Group();
  figure.rotation.y = side === "red" ? Math.PI * 0.5 : -Math.PI * 0.5;
  group.add(figure);

  if (type === "general") buildGeneral(figure, palette);
  if (type === "advisor") buildAdvisor(figure, palette);
  if (type === "elephant") buildElephant(figure, palette);
  if (type === "rook") buildRook(figure, palette);
  if (type === "cannon") buildCannon(figure, palette);
  if (type === "horse") buildHorse(group, palette);
  if (type === "soldier") buildSoldier(group, palette);

  return group;
}

function buildPalette(side) {
  if (side === "red") {
    return {
      primary: new THREE.MeshStandardMaterial({ color: 0xd6454f, roughness: 0.34, metalness: 0.36 }),
      secondary: new THREE.MeshStandardMaterial({ color: 0x7f1820, roughness: 0.4, metalness: 0.34 }),
      accent: new THREE.MeshStandardMaterial({ color: 0xf5d282, roughness: 0.26, metalness: 0.5 }),
    };
  }

  return {
    primary: new THREE.MeshStandardMaterial({ color: 0x8b98b0, roughness: 0.37, metalness: 0.36 }),
    secondary: new THREE.MeshStandardMaterial({ color: 0x4a556e, roughness: 0.46, metalness: 0.32 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xe6ecf5, roughness: 0.29, metalness: 0.5 }),
  };
}

function createPedestal(group, palette, scale) {
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8 * scale, 0.9 * scale, 0.3 * scale, 30), palette.secondary);
  base.position.y = 0.16;
  group.add(base);

  const topRing = new THREE.Mesh(new THREE.TorusGeometry(0.69 * scale, 0.06 * scale, 12, 34), palette.accent);
  topRing.rotation.x = Math.PI * 0.5;
  topRing.position.y = 0.33;
  group.add(topRing);
}

function addMesh(group, geometry, material, x, y, z, rotation) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  if (rotation) mesh.rotation.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
  group.add(mesh);
  return mesh;
}

// Nhân vật đứng: áo choàng, đai, vai, hai tay, đầu. Trả về độ cao đỉnh đầu.
function addHumanoid(group, palette, { x = 0, y = 0.31, scale = 1, robeMaterial, armAngle = 0.35 } = {}) {
  const s = scale;
  const robe = robeMaterial || palette.primary;
  const shape = new THREE.Group();
  shape.position.set(x, y, 0);
  group.add(shape);

  addMesh(shape, new THREE.CylinderGeometry(0.2 * s, 0.34 * s, 0.82 * s, 20), robe, 0, 0.41 * s, 0);
  const belt = addMesh(shape, new THREE.TorusGeometry(0.24 * s, 0.045 * s, 10, 24), palette.accent, 0, 0.56 * s, 0);
  belt.rotation.x = Math.PI * 0.5;
  const shoulders = addMesh(shape, new THREE.SphereGeometry(0.27 * s, 18, 14), palette.secondary, 0, 0.84 * s, 0);
  shoulders.scale.set(1, 0.6, 1.25);
  [-1, 1].forEach((side) => {
    addMesh(shape, new THREE.CylinderGeometry(0.06 * s, 0.05 * s, 0.5 * s, 10), robe, 0.05 * s, 0.62 * s, side * 0.33 * s, [side * armAngle, 0, 0]);
    addMesh(shape, new THREE.SphereGeometry(0.06 * s, 10, 8), skinMaterial, 0.05 * s, 0.4 * s, side * (0.33 + Math.sin(armAngle) * 0.25) * s);
  });
  addMesh(shape, new THREE.CylinderGeometry(0.07 * s, 0.08 * s, 0.1 * s, 12), skinMaterial, 0, 0.94 * s, 0);
  addMesh(shape, new THREE.SphereGeometry(0.17 * s, 20, 16), skinMaterial, 0, 1.1 * s, 0);
  // mắt và râu
  [-1, 1].forEach((side) => addMesh(shape, new THREE.SphereGeometry(0.022 * s, 8, 8), darkMaterial, 0.15 * s, 1.13 * s, side * 0.06 * s));
  return { shape, top: y + 1.27 * s };
}

function buildGeneral(group, palette) {
  const { shape } = addHumanoid(group, palette, { scale: 1.12, robeMaterial: palette.primary, armAngle: 0.5 });
  const s = 1.12;
  // áo choàng sau lưng
  addMesh(shape, new THREE.BoxGeometry(0.06 * s, 0.85 * s, 0.6 * s), palette.secondary, -0.24 * s, 0.5 * s, 0, [0, 0, 0.12]);
  // mũ giáp vương miện
  addMesh(shape, new THREE.CylinderGeometry(0.19 * s, 0.2 * s, 0.14 * s, 20), palette.accent, 0, 1.24 * s, 0);
  addMesh(shape, new THREE.ConeGeometry(0.17 * s, 0.3 * s, 16), palette.secondary, 0, 1.46 * s, 0);
  addMesh(shape, new THREE.SphereGeometry(0.06 * s, 12, 10), palette.accent, 0, 1.66 * s, 0);
  // lông chim hai bên mũ
  [-1, 1].forEach((side) => addMesh(shape, new THREE.ConeGeometry(0.035 * s, 0.5 * s, 8), palette.accent, -0.05 * s, 1.5 * s, side * 0.2 * s, [side * 0.5, 0, 0.35]));
  // kiếm dựng trước ngực
  addMesh(shape, new THREE.BoxGeometry(0.04 * s, 0.85 * s, 0.09 * s), steelMaterial, 0.3 * s, 0.6 * s, 0);
  addMesh(shape, new THREE.BoxGeometry(0.07 * s, 0.05 * s, 0.3 * s), palette.accent, 0.3 * s, 0.2 * s, 0);
}

function buildAdvisor(group, palette) {
  const { shape } = addHumanoid(group, palette, { scale: 0.98, robeMaterial: palette.primary, armAngle: 0.2 });
  const s = 0.98;
  // mũ quan văn: nón phẳng có hai cánh
  addMesh(shape, new THREE.CylinderGeometry(0.15 * s, 0.17 * s, 0.2 * s, 18), darkMaterial, 0, 1.3 * s, 0);
  addMesh(shape, new THREE.CylinderGeometry(0.19 * s, 0.19 * s, 0.03 * s, 18), palette.accent, 0, 1.4 * s, 0);
  [-1, 1].forEach((side) => addMesh(shape, new THREE.BoxGeometry(0.03 * s, 0.03 * s, 0.4 * s), darkMaterial, -0.1 * s, 1.3 * s, side * 0.28 * s));
  // cổ áo và râu
  addMesh(shape, new THREE.ConeGeometry(0.09 * s, 0.24 * s, 10), darkMaterial, 0.11 * s, 0.98 * s, 0, [0, 0, Math.PI]);
  // quạt lông trên tay
  const fan = addMesh(shape, new THREE.CylinderGeometry(0.22 * s, 0.22 * s, 0.02 * s, 20, 1, false, 0, Math.PI), palette.accent, 0.3 * s, 0.55 * s, 0.38 * s, [Math.PI * 0.5, 0, 0]);
  fan.rotation.y = Math.PI * 0.5;
}

function buildElephant(group, palette) {
  const body = addMesh(group, new THREE.SphereGeometry(0.43, 20, 18), palette.primary, -0.05, 0.8, 0);
  body.scale.set(1.15, 0.9, 0.95);
  addMesh(group, new THREE.SphereGeometry(0.27, 18, 16), palette.secondary, 0.36, 0.86, 0);
  addMesh(group, new THREE.CylinderGeometry(0.1, 0.07, 0.5, 14), palette.secondary, 0.58, 0.68, 0, [0, 0, Math.PI * 0.32]);
  [-1, 1].forEach((side) => {
    const ear = addMesh(group, new THREE.SphereGeometry(0.2, 16, 12), palette.primary, 0.26, 0.94, side * 0.2);
    ear.scale.set(0.4, 0.95, 0.85);
    addMesh(group, new THREE.ConeGeometry(0.05, 0.22, 12), palette.accent, 0.6, 0.62, side * 0.1, [0, 0, Math.PI * 0.44]);
  });
  // yên và người quản tượng ngồi trên lưng
  addMesh(group, new THREE.BoxGeometry(0.6, 0.08, 0.5), palette.accent, -0.05, 1.18, 0);
  const rider = new THREE.Group();
  rider.position.set(-0.05, 0.87, 0);
  group.add(rider);
  const riderBody = addHumanoid(rider, palette, { scale: 0.62, robeMaterial: palette.secondary, armAngle: 0.5 });
  addMesh(riderBody.shape, new THREE.ConeGeometry(0.16 * 0.62, 0.3 * 0.62, 14), palette.accent, 0, 1.4 * 0.62, 0);
}

function buildRook(group, palette) {
  // thân xe chiến
  addMesh(group, new THREE.BoxGeometry(0.95, 0.16, 0.66), palette.secondary, 0, 0.5, 0);
  addMesh(group, new THREE.BoxGeometry(0.95, 0.34, 0.06), palette.primary, 0, 0.7, 0.3);
  addMesh(group, new THREE.BoxGeometry(0.95, 0.34, 0.06), palette.primary, 0, 0.7, -0.3);
  addMesh(group, new THREE.BoxGeometry(0.06, 0.34, 0.66), palette.primary, -0.45, 0.7, 0);
  // hai bánh xe nan hoa
  [-1, 1].forEach((side) => {
    const wheel = new THREE.Group();
    wheel.position.set(0.05, 0.52, side * 0.42);
    group.add(wheel);
    addMesh(wheel, new THREE.TorusGeometry(0.26, 0.05, 10, 24), palette.accent, 0, 0, 0);
    addMesh(wheel, new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10), palette.accent, 0, 0, 0, [Math.PI * 0.5, 0, 0]);
    for (let i = 0; i < 3; i += 1) {
      addMesh(wheel, new THREE.BoxGeometry(0.5, 0.035, 0.035), palette.accent, 0, 0, 0, [0, 0, (i * Math.PI) / 3]);
    }
  });
  // càng xe
  addMesh(group, new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), palette.accent, 0.7, 0.55, 0, [0, 0, Math.PI * 0.5]);
  // người đánh xe đứng trên xe, cầm cờ
  const driver = addHumanoid(group, palette, { x: -0.05, y: 0.58, scale: 0.78, armAngle: 0.4 });
  const s = 0.78;
  addMesh(driver.shape, new THREE.ConeGeometry(0.19 * s, 0.32 * s, 16), palette.secondary, 0, 1.36 * s, 0);
  addMesh(driver.shape, new THREE.CylinderGeometry(0.02, 0.02, 1.0, 8), palette.accent, 0.28 * s, 0.9 * s, 0.3 * s);
  addMesh(driver.shape, new THREE.BoxGeometry(0.02, 0.28, 0.4), palette.secondary, 0.28 * s, 1.28, 0.5 * s);
}

function buildCannon(group, palette) {
  // bệ pháo và nòng
  addMesh(group, new THREE.BoxGeometry(0.9, 0.16, 0.6), palette.secondary, 0.1, 0.44, 0);
  [-1, 1].forEach((side) => {
    const wheel = addMesh(group, new THREE.CylinderGeometry(0.2, 0.2, 0.08, 18), palette.accent, 0.15, 0.44, side * 0.36, [Math.PI * 0.5, 0, 0]);
    wheel.name = "wheel";
  });
  const barrel = addMesh(group, new THREE.CylinderGeometry(0.13, 0.17, 1.0, 18), palette.primary, 0.3, 0.72, 0, [0, 0, Math.PI * 0.5 - 0.22]);
  addMesh(group, new THREE.TorusGeometry(0.14, 0.035, 10, 24), palette.accent, 0.78, 0.83, 0, [0, Math.PI * 0.5, -0.22]);
  addMesh(group, new THREE.SphereGeometry(0.15, 14, 12), palette.primary, -0.2, 0.62, 0);
  barrel.userData.barrel = true;
  // pháo thủ đứng phía sau, tay cầm ngòi
  const gunner = addHumanoid(group, palette, { x: -0.42, y: 0.31, scale: 0.72, armAngle: 0.5 });
  const s = 0.72;
  addMesh(gunner.shape, new THREE.CylinderGeometry(0.18 * s, 0.2 * s, 0.1 * s, 16), palette.secondary, 0, 1.25 * s, 0);
  addMesh(gunner.shape, new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), darkMaterial, 0.3 * s, 0.6 * s, 0.3 * s, [0, 0, 0.5]);
  addMesh(gunner.shape, new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff8a3a, emissive: 0xff5a10, emissiveIntensity: 1.2 }), 0.42 * s, 0.85 * s, 0.3 * s);
}

async function loadCharacterModels() {
  const loader = new GLTFLoader();
  const sources = { horse: "./models/Horse.glb", soldier: "./models/Soldier.glb" };
  await Promise.all(
    Object.entries(sources).map(async ([type, url]) => {
      try {
        characterModels[type] = await loader.loadAsync(url);
      } catch (error) {
        console.warn(`Không nạp được ${url}, dùng mô hình dựng bằng code.`, error);
      }
    }),
  );
}

function addCharacterModel(group, type, side, { height, fitLength, rotationY, idleClip }) {
  const gltf = characterModels[type];
  if (!gltf) return false;

  const model = cloneSkinned(gltf.scene);
  const tint = new THREE.Color(side === "red" ? 0xffc2b4 : 0xf2f7ff);
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.frustumCulled = false;
    child.material = child.material.clone();
    child.material.color.multiply(tint);
  });

  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = fitLength ? fitLength / Math.max(size.x, size.z) : height / size.y;
  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, 0.31 - box.min.y * scale, -center.z * scale);

  const holder = new THREE.Group();
  holder.rotation.y = rotationY + (side === "red" ? Math.PI : 0);
  holder.add(model);
  group.add(holder);

  const clip = idleClip && gltf.animations.find((a) => a.name === idleClip);
  if (clip) {
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(clip).play();
    mixer.update(Math.random() * clip.duration);
    characterMixers.push(mixer);
  }
  return true;
}

function buildHorse(group, palette) {
  if (addCharacterModel(group, "horse", group.userData.side, { fitLength: 2.2, rotationY: 0 })) return;

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.76, 16), palette.primary);
  body.position.y = 0.84;
  body.rotation.z = Math.PI * 0.5;
  group.add(body);

  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.5, 0.23), palette.primary);
  neck.position.set(0.24, 1.03, 0);
  neck.rotation.z = -Math.PI * 0.2;
  group.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 14), palette.secondary);
  head.position.set(0.37, 1.24, 0);
  group.add(head);

  const earLeft = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 10), palette.secondary);
  earLeft.position.set(0.43, 1.44, 0.08);
  earLeft.rotation.z = -Math.PI * 0.14;
  group.add(earLeft);

  const earRight = earLeft.clone();
  earRight.position.z = -0.08;
  group.add(earRight);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 12), palette.accent);
  tail.position.set(-0.45, 0.9, 0);
  tail.rotation.z = -Math.PI * 0.7;
  group.add(tail);
}

function buildSoldier(group, palette) {
  if (addCharacterModel(group, "soldier", group.userData.side, { height: 1.6, rotationY: 0, idleClip: "Idle" })) return;

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.31, 0.68, 18), palette.primary);
  body.position.y = 0.72;
  group.add(body);

  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.29, 16, 14), palette.secondary);
  shoulder.position.y = 1.11;
  shoulder.scale.set(1.08, 0.8, 1.08);
  group.add(shoulder);

  const helmet = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.37, 14), palette.primary);
  helmet.position.y = 1.4;
  group.add(helmet);

  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.36, 0.28), palette.accent);
  shield.position.set(0.17, 0.84, 0);
  shield.rotation.z = Math.PI * 0.22;
  group.add(shield);
}

function onPointerDown(event) {
  if (gameState.winner) {
    updateHudStatus(`Ván đã kết thúc. ${sideLabels[gameState.winner]} thắng, bấm Ván mới để chơi lại.`);
    return;
  }

  if (!isHumanTurn()) {
    updateHudStatus("Đang tới lượt máy.");
    return;
  }

  updatePointer(event);
  const pickedPiece = pickPieceFromPointer();

  if (pickedPiece) {
    handlePieceClick(pickedPiece);
    return;
  }

  const boardCell = pickBoardCellFromPointer();
  if (!boardCell) {
    clearSelection();
    updateHudStatus("Click vào giao điểm bàn cờ để đi quân.");
    return;
  }

  handleBoardClick(boardCell.file, boardCell.rank);
}

function updatePointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickPieceFromPointer() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickTargets, true);
  if (!hits.length) return null;

  const picked = findPieceRoot(hits[0].object);
  if (!picked || picked.userData.captured) return null;
  return picked;
}

function pickBoardCellFromPointer() {
  raycaster.setFromCamera(pointer, camera);
  const hitPoint = new THREE.Vector3();
  const intersectsPlane = raycaster.ray.intersectPlane(boardRayPlane, hitPoint);
  if (!intersectsPlane) return null;

  const { file, rank } = worldToBoard(hitPoint.x, hitPoint.z);
  if (!isInsideBoard(file, rank)) return null;

  const snapped = boardToWorld(file, rank);
  const dx = hitPoint.x - snapped.x;
  const dz = hitPoint.z - snapped.z;
  const distance = Math.hypot(dx, dz);

  if (distance > boardConfig.spacing * 0.48) return null;
  return { file, rank };
}

function handlePieceClick(piece) {
  const selected = gameState.selectedPiece;

  if (!selected) {
    if (piece.userData.side !== gameState.currentSide) {
      updateHudStatus(`Đang tới lượt ${sideLabels[gameState.currentSide]}.`);
      return;
    }
    setSelectedPiece(piece);
    return;
  }

  if (selected === piece) {
    clearSelection();
    updateHudStatus("Đã bỏ chọn quân cờ.");
    return;
  }

  if (piece.userData.side === gameState.currentSide) {
    setSelectedPiece(piece);
    return;
  }

  const success = tryMoveSelectedTo(piece.userData.file, piece.userData.rank);
  if (!success) {
    updateHudStatus("Nước đi không hợp lệ theo luật cờ tướng.");
  }
}

function handleBoardClick(file, rank) {
  if (!gameState.selectedPiece) {
    updateHudStatus("Hãy chọn một quân cờ trước.");
    return;
  }

  const success = tryMoveSelectedTo(file, rank);
  if (!success) {
    updateHudStatus("Nước đi không hợp lệ theo luật cờ tướng.");
  }
}

function setSelectedPiece(piece) {
  gameState.selectedPiece = piece;
  selectionRing.visible = true;
  selectionRing.position.x = piece.position.x;
  selectionRing.position.z = piece.position.z;
  selectedDom.textContent = `Đang chọn: ${pieceLabels[piece.userData.type]} - ${sideLabels[piece.userData.side]}`;
  renderMoveHints(piece);
  updateHudStatus(`Đã chọn ${pieceLabels[piece.userData.type]} (${sideLabels[piece.userData.side]}).`);
}

function clearSelection() {
  gameState.selectedPiece = null;
  selectionRing.visible = false;
  selectedDom.textContent = "Đang chọn: Chưa có";
  clearMoveHints();
  clearCaptureGlow();
}

function clearMoveHints() {
  while (moveHintGroup.children.length) {
    const hint = moveHintGroup.children.pop();
    moveHintGroup.remove(hint);
  }
}

function renderMoveHints(piece) {
  clearMoveHints();
  clearCaptureGlow();
  const moves = getLegalMoves(piece);

  moves.forEach((move) => {
    const pos = boardToWorld(move.file, move.rank);
    const target = getPieceAt(move.file, move.rank);
    const isCapture = Boolean(target && target.userData.side !== piece.userData.side);

    const mat = new THREE.MeshBasicMaterial({
      color: isCapture ? 0xff6d6d : 0x86ffd2,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.34, 20), mat);
    ring.rotation.x = -Math.PI * 0.5;
    ring.position.set(pos.x, boardTopY + 0.255, pos.z);
    moveHintGroup.add(ring);

    if (isCapture && target) {
      captureGlowPieces.add(target);
      setPieceCaptureGlow(target, true, clock.getElapsedTime());
    }
  });
}

function clearCaptureGlow() {
  captureGlowPieces.forEach((piece) => {
    setPieceCaptureGlow(piece, false, 0);
  });
  captureGlowPieces.clear();
}

function setPieceCaptureGlow(piece, enabled, time) {
  if (!piece || piece.userData.captured) return;

  const pulse = enabled ? 0.35 + Math.sin(time * 8 + piece.userData.bobSeed) * 0.2 : 0;
  piece.traverse((child) => {
    if (!child.isMesh) return;
    const material = child.material;
    if (!material || !("emissive" in material)) return;

    if (enabled) {
      material.emissive.setHex(0xff5e3a);
      material.emissiveIntensity = pulse;
    } else {
      material.emissive.setHex(0x000000);
      material.emissiveIntensity = 0;
    }
  });
}

function tryMoveSelectedTo(toFile, toRank) {
  const piece = gameState.selectedPiece;
  if (!piece) return false;

  if (piece.userData.side !== gameState.currentSide) {
    return false;
  }

  if (!isMoveLegal(piece, toFile, toRank)) {
    return false;
  }

  executeMove(piece, toFile, toRank, "human");
  return true;
}

function executeMove(piece, toFile, toRank, by) {
  const fromFile = piece.userData.file;
  const fromRank = piece.userData.rank;
  const fromKey = squareKey(fromFile, fromRank);
  const toKey = squareKey(toFile, toRank);
  const target = getPieceAt(toFile, toRank);

  boardMap.delete(fromKey);

  const now = clock.getElapsedTime();
  const moveDuration = 0.42;
  const pos = boardToWorld(toFile, toRank);
  piece.userData.anim = {
    fromX: piece.position.x,
    fromZ: piece.position.z,
    toX: pos.x,
    toZ: pos.z,
    start: now,
    duration: moveDuration,
    hop: target ? 1.1 : 0.7,
  };

  if (target) {
    target.userData.captured = true;
    boardMap.delete(toKey);
    moveEffects.push({
      kind: "dying",
      piece: target,
      start: now + moveDuration * 0.85,
      duration: 0.7,
      burst: false,
    });
  }

  boardMap.set(toKey, piece);
  piece.userData.file = toFile;
  piece.userData.rank = toRank;

  clearSelection();

  if (target && target.userData.type === "general") {
    gameState.winner = piece.userData.side;
    clearTimeout(gameState.aiTimer);
    gameState.aiTimer = null;
    const winnerLabel = sideLabels[gameState.winner];
    updateHudStatus(`${winnerLabel} thắng! ${pieceLabels[piece.userData.type]} đã bắt tướng.`);
    return;
  }

  gameState.currentSide = piece.userData.side === "red" ? "black" : "red";

  const actor = by === "ai" ? "Máy" : "Người chơi";
  const action = target
    ? `${pieceLabels[piece.userData.type]} ăn ${pieceLabels[target.userData.type]}`
    : `${pieceLabels[piece.userData.type]} di chuyển`;
  updateHudStatus(`${actor}: ${action}.`);

  scheduleAiMoveIfNeeded();
}

function scheduleAiMoveIfNeeded() {
  clearTimeout(gameState.aiTimer);
  gameState.aiTimer = null;

  if (!isAiTurn()) return;

  gameState.aiTimer = setTimeout(() => {
    const legalMoves = generateAllLegalMoves(aiSide);

    if (!legalMoves.length) {
      gameState.winner = humanSide;
      updateHudStatus("Máy không còn nước đi hợp lệ. Đỏ thắng.");
      return;
    }

    const bestMove = chooseAiMove(legalMoves);
    executeMove(bestMove.piece, bestMove.file, bestMove.rank, "ai");
  }, 520);

  updateHudStatus("Máy đang suy nghĩ...");
}

function chooseAiMove(legalMoves) {
  let bestScore = -Infinity;
  let best = legalMoves[0];

  legalMoves.forEach((move) => {
    const target = getPieceAt(move.file, move.rank);
    const captureScore = target ? pieceValues[target.userData.type] * 10 : 0;
    const centerScore = 4 - Math.abs(move.file - 4);
    const advanceScore = 9 - move.rank;
    const noise = Math.random() * 0.4;

    const score = captureScore + centerScore * 0.8 + advanceScore * 0.25 + noise;
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  });

  return best;
}

function generateAllLegalMoves(side) {
  const allMoves = [];

  pieces.forEach((piece) => {
    if (piece.userData.captured || piece.userData.side !== side) return;

    const moves = getLegalMoves(piece);
    moves.forEach((move) => {
      allMoves.push({ piece, file: move.file, rank: move.rank });
    });
  });

  return allMoves;
}

function getLegalMoves(piece) {
  const pseudoMoves = generatePseudoMoves(piece);
  return pseudoMoves.filter((move) => isMoveLegal(piece, move.file, move.rank));
}

function isMoveLegal(piece, toFile, toRank) {
  if (piece.userData.captured) return false;
  if (!isInsideBoard(toFile, toRank)) return false;

  const fromFile = piece.userData.file;
  const fromRank = piece.userData.rank;
  if (fromFile === toFile && fromRank === toRank) return false;

  const target = getPieceAt(toFile, toRank);
  if (target && target.userData.side === piece.userData.side) return false;

  const pseudoMoves = generatePseudoMoves(piece);
  const exists = pseudoMoves.some((move) => move.file === toFile && move.rank === toRank);
  if (!exists) return false;

  if (wouldGeneralsFaceAfterMove(piece, toFile, toRank)) return false;

  return true;
}

function generatePseudoMoves(piece) {
  const { type } = piece.userData;

  if (type === "general") return dedupeMoves(generateGeneralMoves(piece));
  if (type === "advisor") return dedupeMoves(generateAdvisorMoves(piece));
  if (type === "elephant") return dedupeMoves(generateElephantMoves(piece));
  if (type === "horse") return dedupeMoves(generateHorseMoves(piece));
  if (type === "rook") return dedupeMoves(generateRookMoves(piece));
  if (type === "cannon") return dedupeMoves(generateCannonMoves(piece));
  return dedupeMoves(generateSoldierMoves(piece));
}

function dedupeMoves(moves) {
  const seen = new Set();
  const result = [];

  moves.forEach((move) => {
    const key = squareKey(move.file, move.rank);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(move);
  });

  return result;
}

function generateGeneralMoves(piece) {
  const moves = [];
  const { file, rank, side } = piece.userData;

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  dirs.forEach(([df, dr]) => {
    const nf = file + df;
    const nr = rank + dr;
    if (!isInPalace(side, nf, nr)) return;

    const target = getPieceAt(nf, nr);
    if (!target || target.userData.side !== side) {
      moves.push({ file: nf, rank: nr });
    }
  });

  const enemyGeneral = findGeneral(side === "red" ? "black" : "red");
  if (enemyGeneral && enemyGeneral.userData.file === file) {
    const clear = isPathClearOnFile(file, rank, enemyGeneral.userData.rank);
    if (clear) {
      moves.push({ file: enemyGeneral.userData.file, rank: enemyGeneral.userData.rank });
    }
  }

  return moves;
}

function generateAdvisorMoves(piece) {
  const moves = [];
  const { file, rank, side } = piece.userData;
  const deltas = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  deltas.forEach(([df, dr]) => {
    const nf = file + df;
    const nr = rank + dr;
    if (!isInPalace(side, nf, nr)) return;

    const target = getPieceAt(nf, nr);
    if (!target || target.userData.side !== side) {
      moves.push({ file: nf, rank: nr });
    }
  });

  return moves;
}

function generateElephantMoves(piece) {
  const moves = [];
  const { file, rank, side } = piece.userData;
  const deltas = [
    [2, 2],
    [2, -2],
    [-2, 2],
    [-2, -2],
  ];

  deltas.forEach(([df, dr]) => {
    const nf = file + df;
    const nr = rank + dr;
    if (!isInsideBoard(nf, nr)) return;

    if (side === "red" && nr > 4) return;
    if (side === "black" && nr < 5) return;

    const eyeFile = file + df * 0.5;
    const eyeRank = rank + dr * 0.5;
    if (getPieceAt(eyeFile, eyeRank)) return;

    const target = getPieceAt(nf, nr);
    if (!target || target.userData.side !== side) {
      moves.push({ file: nf, rank: nr });
    }
  });

  return moves;
}

function generateHorseMoves(piece) {
  const moves = [];
  const { file, rank, side } = piece.userData;

  const patterns = [
    { df: 2, dr: 1, lf: 1, lr: 0 },
    { df: 2, dr: -1, lf: 1, lr: 0 },
    { df: -2, dr: 1, lf: -1, lr: 0 },
    { df: -2, dr: -1, lf: -1, lr: 0 },
    { df: 1, dr: 2, lf: 0, lr: 1 },
    { df: -1, dr: 2, lf: 0, lr: 1 },
    { df: 1, dr: -2, lf: 0, lr: -1 },
    { df: -1, dr: -2, lf: 0, lr: -1 },
  ];

  patterns.forEach((pattern) => {
    const legFile = file + pattern.lf;
    const legRank = rank + pattern.lr;
    if (getPieceAt(legFile, legRank)) return;

    const nf = file + pattern.df;
    const nr = rank + pattern.dr;
    if (!isInsideBoard(nf, nr)) return;

    const target = getPieceAt(nf, nr);
    if (!target || target.userData.side !== side) {
      moves.push({ file: nf, rank: nr });
    }
  });

  return moves;
}

function generateRookMoves(piece) {
  return generateSlidingMoves(piece, false);
}

function generateCannonMoves(piece) {
  return generateSlidingMoves(piece, true);
}

function generateSlidingMoves(piece, isCannon) {
  const moves = [];
  const { file, rank, side } = piece.userData;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  dirs.forEach(([df, dr]) => {
    let nf = file + df;
    let nr = rank + dr;
    let jumped = false;

    while (isInsideBoard(nf, nr)) {
      const target = getPieceAt(nf, nr);

      if (!isCannon) {
        if (!target) {
          moves.push({ file: nf, rank: nr });
        } else {
          if (target.userData.side !== side) {
            moves.push({ file: nf, rank: nr });
          }
          break;
        }
      } else if (!jumped) {
        if (!target) {
          moves.push({ file: nf, rank: nr });
        } else {
          jumped = true;
        }
      } else {
        if (target) {
          if (target.userData.side !== side) {
            moves.push({ file: nf, rank: nr });
          }
          break;
        }
      }

      nf += df;
      nr += dr;
    }
  });

  return moves;
}

function generateSoldierMoves(piece) {
  const moves = [];
  const { file, rank, side } = piece.userData;
  const forward = side === "red" ? 1 : -1;

  const fr = rank + forward;
  if (isInsideBoard(file, fr)) {
    const target = getPieceAt(file, fr);
    if (!target || target.userData.side !== side) {
      moves.push({ file, rank: fr });
    }
  }

  const crossed = side === "red" ? rank >= 5 : rank <= 4;
  if (crossed) {
    [file - 1, file + 1].forEach((nf) => {
      if (!isInsideBoard(nf, rank)) return;
      const target = getPieceAt(nf, rank);
      if (!target || target.userData.side !== side) {
        moves.push({ file: nf, rank });
      }
    });
  }

  return moves;
}

function wouldGeneralsFaceAfterMove(piece, toFile, toRank) {
  const fromFile = piece.userData.file;
  const fromRank = piece.userData.rank;
  const fromKey = squareKey(fromFile, fromRank);
  const toKey = squareKey(toFile, toRank);
  const captured = getPieceAt(toFile, toRank);

  boardMap.delete(fromKey);
  if (captured) boardMap.delete(toKey);
  boardMap.set(toKey, piece);

  piece.userData.file = toFile;
  piece.userData.rank = toRank;

  const facing = areGeneralsFacing();

  piece.userData.file = fromFile;
  piece.userData.rank = fromRank;

  boardMap.delete(toKey);
  boardMap.set(fromKey, piece);
  if (captured) boardMap.set(toKey, captured);

  return facing;
}

function areGeneralsFacing() {
  const redGeneral = findGeneral("red");
  const blackGeneral = findGeneral("black");
  if (!redGeneral || !blackGeneral) return false;

  const redFile = redGeneral.userData.file;
  const blackFile = blackGeneral.userData.file;
  if (redFile !== blackFile) return false;

  return isPathClearOnFile(redFile, redGeneral.userData.rank, blackGeneral.userData.rank);
}

function findGeneral(side) {
  return pieces.find((piece) => !piece.userData.captured && piece.userData.side === side && piece.userData.type === "general") || null;
}

function isPathClearOnFile(file, rankA, rankB) {
  const low = Math.min(rankA, rankB) + 1;
  const high = Math.max(rankA, rankB) - 1;
  for (let rank = low; rank <= high; rank += 1) {
    if (getPieceAt(file, rank)) return false;
  }
  return true;
}

function getPieceAt(file, rank) {
  return boardMap.get(squareKey(file, rank)) || null;
}

function squareKey(file, rank) {
  return `${file},${rank}`;
}

function isInsideBoard(file, rank) {
  return file >= 0 && file < boardConfig.files && rank >= 0 && rank < boardConfig.ranks;
}

function isInPalace(side, file, rank) {
  if (file < 3 || file > 5) return false;
  if (side === "red") return rank >= 0 && rank <= 2;
  return rank >= 7 && rank <= 9;
}

function findPieceRoot(object) {
  let current = object;
  while (current) {
    if (pieces.includes(current)) return current;
    current = current.parent;
  }
  return null;
}

function isHumanTurn() {
  if (gameState.mode === "pvp") return true;
  return gameState.currentSide === humanSide;
}

function isAiTurn() {
  return gameState.mode === "ai" && !gameState.winner && gameState.currentSide === aiSide;
}

function updateHudStatus(message = "") {
  const modeLabel = gameState.mode === "ai" ? "1 người chơi với máy" : "2 người chơi";
  modeTextDom.textContent = `Chế độ hiện tại: ${modeLabel}`;

  if (gameState.winner) {
    turnTextDom.textContent = `Kết thúc: ${sideLabels[gameState.winner]} thắng`;
  } else {
    turnTextDom.textContent = `Lượt: ${sideLabels[gameState.currentSide]}`;
  }
  turnTextDom.dataset.side = gameState.winner || gameState.currentSide;

  if (message) {
    statusTextDom.textContent = message;
    return;
  }

  if (isAiTurn()) {
    statusTextDom.textContent = "Máy đang suy nghĩ...";
    return;
  }

  statusTextDom.textContent = "Sẵn sàng.";
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);

  const t = clock.getElapsedTime();
  const dt = t - lastTime;
  lastTime = t;
  characterMixers.forEach((mixer) => mixer.update(dt));

  pieces.forEach((piece) => {
    if (piece.userData.captured) return;

    const { bobSeed, bobAmp, baseY, baseScale, anim } = piece.userData;
    let hopY = 0;
    if (anim) {
      const u = Math.min((t - anim.start) / anim.duration, 1);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      piece.position.x = anim.fromX + (anim.toX - anim.fromX) * e;
      piece.position.z = anim.fromZ + (anim.toZ - anim.fromZ) * e;
      hopY = Math.sin(Math.PI * u) * anim.hop;
      if (u >= 1) piece.userData.anim = null;
    }
    piece.position.y = baseY + hopY + Math.sin(t * 1.7 + bobSeed) * bobAmp;
    const pulse = 1 + Math.sin(t * 1.2 + bobSeed) * 0.01;
    piece.scale.set(baseScale.x * pulse, baseScale.y * pulse, baseScale.z * pulse);
  });

  captureGlowPieces.forEach((piece) => {
    setPieceCaptureGlow(piece, true, t);
  });

  riverFlowTracks.forEach((track, idx) => {
    const drift = (t * track.speed * track.direction) % 1;
    track.texture.offset.x = drift;
    track.texture.offset.y = Math.sin(t * (0.9 + idx * 0.22)) * track.wobble;
  });

  riverRipples.forEach((ripple) => {
    const { phase, baseX, baseZ, swayX } = ripple.userData;
    ripple.position.x = baseX + Math.sin(t * 1.9 + phase) * swayX;
    ripple.position.z = baseZ + Math.cos(t * 1.1 + phase) * 0.02;
    ripple.material.opacity = 0.1 + Math.sin(t * 2.6 + phase) * 0.06;
  });

  if (riverSurfaceMaterial) {
    riverSurfaceMaterial.opacity = 0.52 + Math.sin(t * 2.1) * 0.06;
  }

  if (selectionRing.visible) {
    selectionRing.rotation.z += 0.02;
    selectionRing.material.emissiveIntensity = 0.48 + Math.sin(t * 4.5) * 0.2;
  }

  updateMoveEffects(t, dt);

  controls.update();
  const shaking = t < cameraShake.until;
  if (shaking) {
    const k = ((cameraShake.until - t) / 0.3) * cameraShake.strength;
    camera.position.x += (Math.random() - 0.5) * k;
    camera.position.y += (Math.random() - 0.5) * k;
  }
  const renderPos = camera.position.clone();
  renderer.render(scene, camera);
  if (shaking) camera.position.copy(renderPos);
}

function updateMoveEffects(t, dt) {
  for (let i = moveEffects.length - 1; i >= 0; i -= 1) {
    const fx = moveEffects[i];

    if (fx.kind === "dying") {
      if (t < fx.start) continue;
      const piece = fx.piece;
      if (!fx.burst) {
        fx.burst = true;
        fx.x = piece.position.x;
        fx.z = piece.position.z;
        spawnCaptureBurst(fx.x, fx.z, piece.userData.side);
        cameraShake.until = t + 0.3;
        cameraShake.strength = 0.5;
      }
      const u = Math.min((t - fx.start) / fx.duration, 1);
      piece.position.set(fx.x, piece.userData.baseY + u * 2.4, fx.z);
      piece.rotation.set(u * 2.2, u * 9, u * 1.4);
      const shrink = Math.max(1 - u * u, 0.001);
      piece.scale.set(piece.userData.baseScale.x * shrink, piece.userData.baseScale.y * shrink, piece.userData.baseScale.z * shrink);
      if (u >= 1) {
        piece.visible = false;
        moveEffects.splice(i, 1);
      }
      continue;
    }

    fx.age += dt;
    const u = fx.age / fx.life;
    if (u >= 1) {
      root.remove(fx.object);
      fx.object.geometry.dispose();
      fx.object.material.dispose();
      moveEffects.splice(i, 1);
      continue;
    }

    if (fx.kind === "ring") {
      fx.object.scale.setScalar(1 + u * 5);
      fx.object.material.opacity = 0.85 * (1 - u);
    } else if (fx.kind === "sparks") {
      const attr = fx.object.geometry.attributes.position;
      for (let j = 0; j < fx.velocities.length; j += 1) {
        const v = fx.velocities[j];
        v.y -= 9 * dt;
        attr.setXYZ(j, attr.getX(j) + v.x * dt, Math.max(attr.getY(j) + v.y * dt, boardTopY + 0.1), attr.getZ(j) + v.z * dt);
      }
      attr.needsUpdate = true;
      fx.object.material.opacity = 1 - u;
    }
  }
}

function spawnCaptureBurst(x, z, side) {
  const color = side === "red" ? 0xff6a4a : 0xbcd2ff;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.68, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI * 0.5;
  ring.position.set(x, boardTopY + 0.2, z);
  root.add(ring);
  moveEffects.push({ kind: "ring", object: ring, age: 0, life: 0.55 });

  const count = 46;
  const positions = new Float32Array(count * 3);
  const velocities = [];
  for (let i = 0; i < count; i += 1) {
    positions.set([x, boardTopY + 0.6, z], i * 3);
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 3.5;
    velocities.push(new THREE.Vector3(Math.cos(angle) * speed, 3 + Math.random() * 4, Math.sin(angle) * speed));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const sparks = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xffd27a, size: 0.26, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  sparks.frustumCulled = false;
  root.add(sparks);
  moveEffects.push({ kind: "sparks", object: sparks, velocities, age: 0, life: 0.9 });
}
