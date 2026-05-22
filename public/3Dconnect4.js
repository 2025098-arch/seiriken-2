import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let socket;
let getState; // main.jsから現在の状態(myRole, currentRoomIdなど)をリアルタイムに取得する関数

let previousBoard = Array(64).fill(null);
let avatars = [];
let pieceMeshes = Array(64).fill(null);

const gameBoard = document.getElementById('game-board');
const padGrid = document.getElementById('pad-grid');

// --- Three.js 空間構築 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f4f9);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.position.set(0, 6, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
gameBoard.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.minDistance = 2;
controls.maxDistance = 15;

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dLight = new THREE.DirectionalLight(0xffffff, 0.8);
dLight.position.set(5, 10, 5);
dLight.castShadow = true;
scene.add(dLight);

const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 4), new THREE.MeshStandardMaterial({ color: 0x8b4513 }));
baseMesh.receiveShadow = true;
baseMesh.position.y = -0.25;
scene.add(baseMesh);

const pegGroup = new THREE.Group();
scene.add(pegGroup);
const pegGeo = new THREE.CylinderGeometry(0.08, 0.08, 4, 16);
const pegMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0 });

for (let i = 0; i < 4; i++) {
  for (let j = 0; j < 4; j++) {
    const peg = new THREE.Mesh(pegGeo, pegMat);
    peg.castShadow = true;
    peg.position.set(i - 1.5, 2, j - 1.5);
    peg.userData.pegIndex = j * 4 + i;
    pegGroup.add(peg);
  }
}

const pieceGeo = new THREE.SphereGeometry(0.35, 32, 16);
const xMat = new THREE.MeshStandardMaterial({ color: 0xff4757, metalness: 0.2, roughness: 0.1 });
const oMat = new THREE.MeshStandardMaterial({ color: 0x1e90ff, metalness: 0.2, roughness: 0.1 });

// --- ヘルパー関数 ---
function getActivePlayerCount(players) {
  return players.filter(p => p.role !== 'Spectator').length;
}

// --- 初期化処理 ---
export function initConnect4(ioSocket, stateGetter) {
  socket = ioSocket;
  getState = stateGetter;

  // 2D パッド生成
  padGrid.innerHTML = '';
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const cell = document.createElement('div');
      cell.classList.add('pad-cell');
      const pegIndex = j * 4 + i;
      cell.addEventListener('click', () => {
        const state = getState();
        if (state.myRole === 'Spectator' || !state.currentRoomId || getActivePlayerCount(state.roomPlayers) < 2 || state.isClassTimeLocal || state.isPausedByDisconnect) return;
        socket.emit('move', { roomId: state.currentRoomId, pegIndex });
      });
      padGrid.appendChild(cell);
    }
  }

  // 3D空間クリック (Raycaster)
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  renderer.domElement.addEventListener('click', (e) => {
    const state = getState();
    if (state.myRole === 'Spectator' || !state.currentRoomId || getActivePlayerCount(state.roomPlayers) < 2 || state.isClassTimeLocal || state.isPausedByDisconnect) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(pegGroup.children);
    if (intersects.length > 0) {
      socket.emit('move', { roomId: state.currentRoomId, pegIndex: intersects[0].object.userData.pegIndex });
    }
  });

  animate();
  window.addEventListener('resize', resizeCanvas3D);
}

// --- 🎨 3Dパーツ組み立てアバター生成 ---
function createAvatar3D(nickname, iconData) {
  const avatarGroup = new THREE.Group();

  // 頭部 (ベース球体)
  const headGeo = new THREE.SphereGeometry(0.55, 32, 32);
  const headMat = new THREE.MeshStandardMaterial({ color: iconData?.color || '#ffccaa' });
  const head = new THREE.Mesh(headGeo, headMat);
  avatarGroup.add(head);

  // 髪型追加
  const hairColor = iconData?.hairColor || '#111111';
  const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.8 });
  const hairStyle = iconData?.hair || 'none';

  if (hairStyle === 'short') {
    const hairGeo = new THREE.SphereGeometry(0.57, 32, 16, 0, Math.PI*2, 0, Math.PI/2);
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.y = 0.05; 
    avatarGroup.add(hair);
  } else if (hairStyle === 'spiky') {
    const hairGeo = new THREE.SphereGeometry(0.57, 32, 16, 0, Math.PI*2, 0, Math.PI/2);
    const hair = new THREE.Mesh(hairGeo, hairMat); 
    hair.position.y = 0.05; 
    avatarGroup.add(hair);
    for(let i = 0; i < 5; i++){
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 8), hairMat);
      spike.position.set((Math.random()-0.5)*0.6, 0.5, (Math.random()-0.5)*0.6);
      spike.rotation.set((Math.random()-0.5), (Math.random()-0.5), (Math.random()-0.5));
      avatarGroup.add(spike);
    }
  } else if (hairStyle === 'twin') {
    const hairGeo = new THREE.SphereGeometry(0.57, 32, 16, 0, Math.PI*2, 0, Math.PI/2);
    const hair = new THREE.Mesh(hairGeo, hairMat); 
    hair.position.y = 0.05; 
    avatarGroup.add(hair);
    const twinL = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), hairMat); 
    twinL.position.set(-0.6, 0.1, 0);
    const twinR = twinL.clone(); 
    twinR.position.set(0.6, 0.1, 0);
    avatarGroup.add(twinL, twinR);
  }

  // 目のマテリアル
  const customEyeColor = iconData?.eyeColor || '#111111';
  const eyeMat = new THREE.MeshStandardMaterial({ color: customEyeColor });

  // 3Dパーツの目
  if (iconData?.eye === 'angry') {
    const eyeGeoL = new THREE.BoxGeometry(0.25, 0.08, 0.1);
    const eyeL = new THREE.Mesh(eyeGeoL, eyeMat);
    eyeL.position.set(-0.22, 0.15, 0.48);
    eyeL.rotation.z = -0.3;
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.22;
    eyeR.rotation.z = 0.3;
    avatarGroup.add(eyeL, eyeR);
  } else if (iconData?.eye === 'happy') {
    const eyeGeoL = new THREE.BoxGeometry(0.22, 0.08, 0.1);
    const eyeL = new THREE.Mesh(eyeGeoL, eyeMat);
    eyeL.position.set(-0.22, 0.18, 0.48);
    eyeL.rotation.z = 0.25;
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.22;
    eyeR.rotation.z = -0.25;
    avatarGroup.add(eyeL, eyeR);
  } else {
    const eyeGeo = new THREE.SphereGeometry(0.1, 16, 16);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.22, 0.15, 0.49);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.22;
    avatarGroup.add(eyeL, eyeR);
  }

  // 口のマテリアル
  const customMouthColor = iconData?.mouthColor || '#331111';
  const mouthMat = new THREE.MeshStandardMaterial({ color: customMouthColor });

  if (iconData?.mouth === 'smile') {
    const mouthGeo = new THREE.BoxGeometry(0.3, 0.06, 0.1);
    const mouth = new THREE.Mesh(mouthGeo, mouthMat);
    mouth.position.set(0, -0.15, 0.5);
    const edgeGeo = new THREE.BoxGeometry(0.08, 0.1, 0.1);
    const edgeL = new THREE.Mesh(edgeGeo, mouthMat);
    edgeL.position.set(-0.15, -0.12, 0.5);
    const edgeR = edgeL.clone();
    edgeR.position.x = 0.15;
    avatarGroup.add(mouth, edgeL, edgeR);
  } else if (iconData?.mouth === 'sad') {
    const mouthGeo = new THREE.BoxGeometry(0.3, 0.06, 0.1);
    const mouth = new THREE.Mesh(mouthGeo, mouthMat);
    mouth.position.set(0, -0.12, 0.5);
    const edgeGeo = new THREE.BoxGeometry(0.08, 0.1, 0.1);
    const edgeL = new THREE.Mesh(edgeGeo, mouthMat);
    edgeL.position.set(-0.15, -0.15, 0.5);
    const edgeR = edgeL.clone();
    edgeR.position.x = 0.15;
    avatarGroup.add(mouth, edgeL, edgeR);
  } else {
    const mouthGeo = new THREE.BoxGeometry(0.25, 0.06, 0.1);
    const mouth = new THREE.Mesh(mouthGeo, mouthMat);
    mouth.position.set(0, -0.15, 0.5);
    avatarGroup.add(mouth);
  }

  // ひげパーツ
  const beardStyle = iconData?.beard || 'none';
  const beardMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.8 }); 

  if (beardStyle === 'mustache' || beardStyle === 'full') {
    const mustacheL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.06), beardMat);
    mustacheL.position.set(-0.08, -0.07, 0.52);
    mustacheL.rotation.z = -0.15;
    const mustacheR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.06), beardMat);
    mustacheR.position.set(0.08, -0.07, 0.52);
    mustacheR.rotation.z = 0.15;
    avatarGroup.add(mustacheL, mustacheR);
  }

  if (beardStyle === 'beard' || beardStyle === 'full') {
    const beardGeo = new THREE.ConeGeometry(0.18, 0.25, 4);
    const beardMesh = new THREE.Mesh(beardGeo, beardMat);
    beardMesh.position.set(0, -0.48, 0.32);
    beardMesh.rotation.x = Math.PI - 0.2; 
    avatarGroup.add(beardMesh);
  }

  // 頭上の立体ネームプレート
  const nameCanvas = document.createElement('canvas');
  nameCanvas.width = 512; nameCanvas.height = 128;
  const nCtx = nameCanvas.getContext('2d');
  nCtx.fillStyle = 'rgba(44, 62, 80, 0.85)';
  nCtx.roundRect(0, 0, 512, 128, 20);
  nCtx.fill();
  nCtx.fillStyle = 'white';
  nCtx.font = 'bold 48px sans-serif';
  nCtx.textAlign = 'center';
  nCtx.textBaseline = 'middle';
  nCtx.fillText(nickname || 'ゲスト', 256, 64);

  const nameTex = new THREE.CanvasTexture(nameCanvas);
  const spriteMat = new THREE.SpriteMaterial({ map: nameTex });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.position.y = 1.2;
  sprite.scale.set(1.8, 0.45, 1);
  avatarGroup.add(sprite);

  return avatarGroup;
}

// --- エクスポート関数：アバター更新 ---
export function updateAvatars3D() {
  const state = getState();
  avatars.forEach(a => scene.remove(a));
  avatars = [];

  const playerX = state.roomPlayers.find(p => p.role === 'X');
  const playerO = state.roomPlayers.find(p => p.role === 'O');

  if (playerX) {
    const meshX = createAvatar3D(playerX.nickname, playerX.icon);
    const isMeX = (state.myRole === 'X');
    const zPos = isMeX || (state.myRole === 'Spectator') ? 4.5 : -4.5;
    meshX.position.set(-0.8, 1.2, zPos);
    meshX.rotation.y = zPos > 0 ? Math.PI : 0;
    scene.add(meshX);
    avatars.push(meshX);
  }

  if (playerO) {
    const meshO = createAvatar3D(playerO.nickname, playerO.icon);
    const isMeO = (state.myRole === 'O');
    const zPos = isMeO ? 4.5 : -4.5;
    meshO.position.set(0.8, 1.2, zPos);
    meshO.rotation.y = meshO.position.z > 0 ? Math.PI : 0;
    scene.add(meshO);
    avatars.push(meshO);
  }
}

// --- エクスポート関数：ボード描画 ---
export function renderBoard3D(boardData, isNewMove = true) {
  let newMoveIndex = -1;

  boardData.forEach((val, index) => {
    if (pieceMeshes[index] && !val) {
      scene.remove(pieceMeshes[index]);
      pieceMeshes[index] = null;
    } 
    else if (!pieceMeshes[index] && val) {
      const x = (index % 4) - 1.5;
      const z = Math.floor((index % 16) / 4) - 1.5;
      const targetY = Math.floor(index / 16) * 1.0 + 0.35;

      const material = (val === 'X' ? xMat : oMat).clone();
      const piece = new THREE.Mesh(pieceGeo, material);
      piece.castShadow = true;

      if (isNewMove && previousBoard[index] === null) {
        newMoveIndex = index;
        piece.position.set(x, 6, z); // 空中から落下
        piece.userData = { targetY, velocity: 0, isFalling: true };
      } else {
        piece.position.set(x, targetY, z);
        piece.userData = { targetY, velocity: 0, isFalling: false };
      }

      scene.add(piece);
      pieceMeshes[index] = piece;
    }
  });

  // 最新の着手玉を超強力発光
  pieceMeshes.forEach((piece, index) => {
    if (piece) {
      if (index === newMoveIndex || (isNewMove && previousBoard[index] === null && boardData[index] !== null)) {
        piece.material.emissive.setHex(boardData[index] === 'X' ? 0xff0000 : 0x0000ff);
        piece.material.emissiveIntensity = 6.0;
      } else {
        piece.material.emissive.setHex(0x000000);
        piece.material.emissiveIntensity = 0.0;
      }
    }
  });

  previousBoard = [...boardData];
}

// --- エクスポート関数：ボードのリセット（退出時など） ---
export function resetBoard3D() {
  pieceMeshes.forEach((piece, index) => {
    if (piece) {
      scene.remove(piece);
      pieceMeshes[index] = null;
    }
  });
  previousBoard = Array(64).fill(null);
  avatars.forEach(a => scene.remove(a));
  avatars = [];
}

// --- エクスポート関数：エモートのド派手表示 ---
export function showEmoteSplash3D(text, role) {
  const splash = document.createElement('div');
  splash.className = 'emote-text-splash';
  splash.textContent = text;

  if (role === 'X') splash.style.color = '#ff4757';
  else if (role === 'O') splash.style.color = '#1e90ff';
  else splash.style.color = '#747d8c';

  gameBoard.appendChild(splash);

  setTimeout(() => {
    if (splash.parentNode) splash.parentNode.removeChild(splash);
  }, 1500);
}

// --- エクスポート関数：リサイズ処理 ---
export function resizeCanvas3D() {
  const w = gameBoard.offsetWidth;
  const h = gameBoard.offsetHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// --- アニメーションループ（物理挙動・重力） ---
const gravity = -0.012; 
const bounce = -0.35;    

function animate() {
  requestAnimationFrame(animate);

  const state = getState ? getState() : { isPausedByDisconnect: false, isClassTimeLocal: false };

  pieceMeshes.forEach(piece => {
    if (piece && piece.userData.isFalling && !state.isPausedByDisconnect && !state.isClassTimeLocal) {
      piece.userData.velocity += gravity;
      piece.position.y += piece.userData.velocity;

      if (piece.position.y <= piece.userData.targetY) {
        piece.position.y = piece.userData.targetY;
        piece.userData.velocity *= bounce;

        if (Math.abs(piece.userData.velocity) < 0.02) {
          piece.userData.isFalling = false;
          piece.position.y = piece.userData.targetY;
        }
      }
    }
  });

  controls.update();
  renderer.render(scene, camera);
}