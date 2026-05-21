import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const socket = io();

// --- 認証・設定用 DOM要素 ---
const authModal = document.getElementById('auth-modal');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const authNickname = document.getElementById('auth-nickname');
const authPassword = document.getElementById('auth-password');
const authIconEditor = document.getElementById('auth-icon-editor');
const authBtn = document.getElementById('auth-btn');
const authError = document.getElementById('auth-error');

const settingsModal = document.getElementById('settings-modal');
const openSettingsBtn = document.getElementById('open-settings-btn');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsSaveBtn = document.getElementById('settings-save-btn');
const settingsError = document.getElementById('settings-error');

const classTimeWarning = document.getElementById('class-time-warning');
const overlayScreen = document.getElementById('overlay-screen');
const overlayText = document.getElementById('overlay-text');

// --- 既存：DOM要素の全取得 ---
const appContainer = document.getElementById('app-container');
const userInfo = document.getElementById('user-info');
const lobbyContainer = document.getElementById('lobby-container');
const gameContainer = document.getElementById('game-container');
const roomListDiv = document.getElementById('room-list');
const roomNameInput = document.getElementById('room-name-input');
const createBtn = document.getElementById('create-btn');
const backBtn = document.getElementById('back-btn');
const statusDiv = document.getElementById('status');
const gameBoard = document.getElementById('game-board');
const padGrid = document.getElementById('pad-grid');
const rematchArea = document.getElementById('rematch-area');
const rematchBtn = document.getElementById('rematch-btn');
const rematchStatus = document.getElementById('rematch-status');

// チャット・リーダーボード要素
const lobbyChatBox = document.getElementById('lobby-chat-box');
const lobbyChatInput = document.getElementById('lobby-chat-input');
const lobbyChatSendBtn = document.getElementById('lobby-chat-send-btn');
const roomChatBox = document.getElementById('room-chat-box');
const roomChatInput = document.getElementById('room-chat-input');
const roomChatSendBtn = document.getElementById('room-chat-send-btn');
const leaderboardBody = document.getElementById('leaderboard-body');

// --- 状態管理変数 ---
let myUser = null; 
let myRole = '';
let currentRoomId = '';
let roomPlayers = []; 
let previousBoard = Array(64).fill(null);
let avatars = [];

// 新機能・状態追跡用の変数
let isRegisterMode = false;
let isClassTimeLocal = false; 
let isPausedByDisconnect = false;
let currentWinner = null; // 退室ボタンの表記切り替え用に勝者状態を保持

// --- 退出ボタン表記の動的切り替えロジック ---
function updateBackBtnText() {
  // ルームにいて、対戦プレイヤー(XまたはO)であり、決着がついておらず、対戦相手が揃っている場合
  if (currentRoomId && (myRole === 'X' || myRole === 'O') && !currentWinner && getActivePlayerCount() === 2) {
    backBtn.textContent = '退出する（不戦敗）';
  } else {
    backBtn.textContent = '退出する';
  }
}

// --- 認証・ログインロジック ---
tabLogin.addEventListener('click', () => { 
  isRegisterMode = false; 
  tabLogin.classList.add('active'); 
  tabRegister.classList.remove('active'); 
  authIconEditor.style.display = 'none'; 
  authBtn.textContent = 'ログイン'; 
  authError.textContent = ''; 
});

tabRegister.addEventListener('click', () => { 
  isRegisterMode = true; 
  tabRegister.classList.add('active'); 
  tabLogin.classList.remove('active'); 
  authIconEditor.style.display = 'flex'; 
  authBtn.textContent = '新規登録'; 
  authError.textContent = ''; 
});

authBtn.addEventListener('click', () => {
  const nickname = authNickname.value.trim();
  const password = authPassword.value;
  if (!nickname || !/^\d{6}$/.test(password)) {
    authError.textContent = '名前と6桁の数字パスワードを入力してください。';
    return;
  }

  if (isRegisterMode) {
    const icon = { 
      color: document.getElementById('icon-color').value, 
      hairColor: document.getElementById('icon-hair-color').value,
      hair: document.getElementById('icon-hair').value, 
      eye: document.getElementById('icon-eye').value, 
      eyeColor: document.getElementById('icon-eye-color').value, // 拡張：目の色
      mouth: document.getElementById('icon-mouth').value, 
      mouthColor: document.getElementById('icon-mouth-color').value, // 拡張：口の色
      beard: document.getElementById('icon-beard').value // 拡張：ひげの種類
    };
    socket.emit('register', { nickname, password, icon });
  } else {
    socket.emit('login', { nickname, password });
  }
});

socket.on('auth-error', (msg) => { 
  authError.textContent = msg; 
  settingsError.textContent = msg; 
});

socket.on('auth-success', (user) => {
  myUser = user;
  authModal.style.display = 'none';
  settingsModal.style.display = 'none';
  appContainer.style.display = 'block';
  updateUserDisplay();

  // 設定画面に現在の値を自動入力
  document.getElementById('set-nickname').value = user.nickname;
  document.getElementById('set-color').value = user.icon.color;
  document.getElementById('set-hair-color').value = user.icon.hairColor || '#111111';
  document.getElementById('set-hair').value = user.icon.hair || 'none';
  document.getElementById('set-eye').value = user.icon.eye;
  document.getElementById('set-eye-color').value = user.icon.eyeColor || '#111111';
  document.getElementById('set-mouth').value = user.icon.mouth;
  document.getElementById('set-mouth-color').value = user.icon.mouthColor || '#331111';
  document.getElementById('set-beard').value = user.icon.beard || 'none';
});

// --- 設定変更ロジック ---
openSettingsBtn.addEventListener('click', () => { 
  settingsError.textContent = ''; 
  document.getElementById('set-old-password').value = ''; 
  document.getElementById('set-new-password').value = ''; 
  settingsModal.style.display = 'flex'; 
});

settingsCloseBtn.addEventListener('click', () => {
  settingsModal.style.display = 'none';
});

settingsSaveBtn.addEventListener('click', () => {
  const newNickname = document.getElementById('set-nickname').value.trim();
  const oldPassword = document.getElementById('set-old-password').value;
  const newPassword = document.getElementById('set-new-password').value;

  if (!newNickname || !/^\d{6}$/.test(oldPassword)) {
    settingsError.textContent = '名前と現在のパスワード(6桁)は必須です。';
    return;
  }
  if (newPassword && !/^\d{6}$/.test(newPassword)) {
    settingsError.textContent = '新パスワードは6桁の数字にしてください。';
    return;
  }

  const icon = {
    color: document.getElementById('set-color').value, 
    hairColor: document.getElementById('set-hair-color').value,
    hair: document.getElementById('set-hair').value, 
    eye: document.getElementById('set-eye').value,
    eyeColor: document.getElementById('set-eye-color').value, // 拡張
    mouth: document.getElementById('set-mouth').value,
    mouthColor: document.getElementById('set-mouth-color').value, // 拡張
    beard: document.getElementById('set-beard').value // 拡張
  };
  socket.emit('update-profile', { newNickname, oldPassword, newPassword, icon });
});

function updateUserDisplay() {
  userInfo.innerHTML = `ユーザー: <strong>${myUser.nickname}</strong> | 
    【戦績】 総勝:${myUser.totalWins} 総敗:${myUser.totalLosses} 分:${myUser.totalDraws} 
    (勝:${myUser.wins} 敗:${myUser.losses} 不勝:${myUser.defaultWins} 不敗:${myUser.defaultLosses})`;
}

// --- 授業スケジュール管理 ---
socket.on('schedule-status', (isClass) => {
  isClassTimeLocal = isClass;
  if (isClass) {
    classTimeWarning.style.display = 'block';
    createBtn.disabled = true;
    document.querySelectorAll('.join-btn').forEach(btn => btn.disabled = true);
    if (currentRoomId && getActivePlayerCount() >= 2) {
      showOverlay('授業中につき一時停止しています...');
    }
  } else {
    classTimeWarning.style.display = 'none';
    createBtn.disabled = false;
    document.querySelectorAll('.join-btn').forEach(btn => btn.disabled = false);
    if (!isPausedByDisconnect) hideOverlay();
  }
});

// --- 2D パッド生成 ---
for (let j = 0; j < 4; j++) {
  for (let i = 0; i < 4; i++) {
    const cell = document.createElement('div');
    cell.classList.add('pad-cell');
    const pegIndex = j * 4 + i;
    cell.addEventListener('click', () => {
      if (myRole === 'Spectator' || !currentRoomId || getActivePlayerCount() < 2 || isClassTimeLocal || isPausedByDisconnect) return;
      socket.emit('move', { roomId: currentRoomId, pegIndex });
    });
    padGrid.appendChild(cell);
  }
}

function getActivePlayerCount() {
  return roomPlayers.filter(p => p.role !== 'Spectator').length;
}

function showOverlay(msg) { 
  overlayText.textContent = msg; 
  overlayScreen.style.display = 'flex'; 
}

function hideOverlay() { 
  overlayScreen.style.display = 'none'; 
}

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
let pieceMeshes = Array(64).fill(null);

// --- 🎨 3Dパーツ組み立てアバター生成 (目の色・口の色・ひげ対応完全拡張版) ---
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

  // 目のマテリアル（拡張：カスタム目の色対応）
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

  // 口のマテリアル（拡張：カスタム口の色対応）
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

  // --- 拡張新規追加：ひげパーツの3D描画処理 ---
  const beardStyle = iconData?.beard || 'none';
  const beardMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.8 }); // ひげの色は髪色に追従

  if (beardStyle === 'mustache' || beardStyle === 'full') {
    // 口ひげ (ダンディな左右にハの字のひげ)
    const mustacheL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.06), beardMat);
    mustacheL.position.set(-0.08, -0.07, 0.52);
    mustacheL.rotation.z = -0.15;

    const mustacheR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.06), beardMat);
    mustacheR.position.set(0.08, -0.07, 0.52);
    mustacheR.rotation.z = 0.15;

    avatarGroup.add(mustacheL, mustacheR);
  }

  if (beardStyle === 'beard' || beardStyle === 'full') {
    // あごひげ (あご下にフィットする3Dコーン・ブロック)
    const beardGeo = new THREE.ConeGeometry(0.18, 0.25, 4);
    const beardMesh = new THREE.Mesh(beardGeo, beardMat);
    beardMesh.position.set(0, -0.48, 0.32);
    beardMesh.rotation.x = Math.PI - 0.2; // ★180度(Math.PI)回転させて尖った方を下に向ける
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

// アバターの位置と「視線の向き」を完全に制御する
function updateAvatars() {
  avatars.forEach(a => scene.remove(a));
  avatars = [];

  const playerX = roomPlayers.find(p => p.role === 'X');
  const playerO = roomPlayers.find(p => p.role === 'O');

  if (playerX) {
    const meshX = createAvatar3D(playerX.nickname, playerX.icon);
    const isMeX = (myRole === 'X');
    const zPos = isMeX || (myRole === 'Spectator') ? 4.5 : -4.5;
    meshX.position.set(-0.8, 1.2, zPos);
    meshX.rotation.y = zPos > 0 ? Math.PI : 0;
    scene.add(meshX);
    avatars.push(meshX);
  }

  if (playerO) {
    const meshO = createAvatar3D(playerO.nickname, playerO.icon);
    const isMeO = (myRole === 'O');
    const zPos = isMeO ? 4.5 : -4.5;
    meshO.position.set(0.8, 1.2, zPos);
    meshO.rotation.y = meshO.position.z > 0 ? Math.PI : 0;
    scene.add(meshO);
    avatars.push(meshO);
  }
}

// --- ボード描画、強力ハイライト、空中浮遊防止ロジック ---
function renderBoard(boardData, isNewMove = true) {
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

function updateStatus(turn, winnerRole, isDefault = false, leaverName = '') {
  const currentPlayers = getActivePlayerCount();
  currentWinner = winnerRole; // 動的表記切り替え用に状態を同期

  if (currentPlayers < 2 && !winnerRole && !isPausedByDisconnect) {
    showOverlay('対戦相手を待っています...');
    statusDiv.textContent = '待機中...';
    statusDiv.style.color = '#747d8c';
    updateBackBtnText();
    return;
  } else if (!isClassTimeLocal && !isPausedByDisconnect) {
    hideOverlay();
  }

  if (winnerRole) {
    rematchArea.style.display = myRole === 'Spectator' ? 'none' : 'block';
    rematchBtn.style.display = 'inline-block';
    rematchStatus.textContent = '';

    if (winnerRole === 'Draw') {
      statusDiv.textContent = '引き分けです！ 🤝';
      statusDiv.style.color = '#ffa502';
      updateBackBtnText();
      return;
    }

    const p = roomPlayers.find(pl => pl.role === winnerRole);
    const winnerName = p ? p.nickname : winnerRole;

    if (isDefault) {
      statusDiv.textContent = `不戦勝！ ${leaverName}が退出したため、${winnerName} の勝利です！ 🎉`;
    } else {
      statusDiv.textContent = `${winnerName} の勝利です！ 🎉`;
    }
    statusDiv.style.color = winnerRole === 'X' ? '#ff4757' : '#1e90ff';
  } else {
    rematchArea.style.display = 'none';
    const p = roomPlayers.find(pl => pl.role === turn);
    const turnName = p ? p.nickname : turn;

    if (myRole === 'Spectator') {
      statusDiv.textContent = `観戦中 (ターン: ${turnName})`;
    } else {
      statusDiv.textContent = turn === myRole ? 'あなたのターンです！' : `${turnName}の思考中...`;
    }
    statusDiv.style.color = turn === 'X' ? '#ff4757' : '#1e90ff';
  }

  updateBackBtnText(); // すべての条件変化時に表記を瞬時にアップデート
}

// --- チャット処理 ---
function appendChatMessage(box, data) {
  const msgEl = document.createElement('div');
  msgEl.classList.add('chat-msg');

  if (data.role) {
    const roleEl = document.createElement('span');
    roleEl.classList.add('chat-role', `role-${data.role}`);
    roleEl.textContent = data.role;
    msgEl.appendChild(roleEl);
  }

  const nameEl = document.createElement('span');
  nameEl.classList.add('chat-name');
  nameEl.textContent = data.nickname + ': ';

  const textEl = document.createTextNode(data.message);

  msgEl.appendChild(nameEl);
  msgEl.appendChild(textEl);
  box.appendChild(msgEl);
  box.scrollTop = box.scrollHeight;
}

lobbyChatSendBtn.addEventListener('click', () => {
  const msg = lobbyChatInput.value.trim();
  if(!msg) return;
  socket.emit('chat-message', { roomId: null, message: msg });
  lobbyChatInput.value = '';
});

roomChatSendBtn.addEventListener('click', () => {
  const msg = roomChatInput.value.trim();
  if(!msg) return;
  socket.emit('chat-message', { roomId: currentRoomId, message: msg });
  roomChatInput.value = '';
});

lobbyChatInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') lobbyChatSendBtn.click(); });
roomChatInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') roomChatSendBtn.click(); });

// --- 画面切り替え・UI連動イベント ---
createBtn.addEventListener('click', () => {
  socket.emit('create-room', roomNameInput.value.trim());
  roomNameInput.value = '';
});

backBtn.addEventListener('click', () => {
  if(currentRoomId) {
    socket.emit('leave-room', currentRoomId);
  }
  currentRoomId = '';
  currentWinner = null;
  gameContainer.style.display = 'none';
  lobbyContainer.style.display = 'block';
  roomChatBox.innerHTML = '';
});

rematchBtn.addEventListener('click', () => {
  socket.emit('rematch', currentRoomId);
  rematchBtn.style.display = 'none';
  rematchStatus.textContent = '相手の同意を待っています...';
});

// 3D空間クリック
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
renderer.domElement.addEventListener('click', (e) => {
  if (myRole === 'Spectator' || !currentRoomId || getActivePlayerCount() < 2 || isClassTimeLocal || isPausedByDisconnect) return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(pegGroup.children);
  if (intersects.length > 0) {
    socket.emit('move', { roomId: currentRoomId, pegIndex: intersects[0].object.userData.pegIndex });
  }
});

function resizeCanvas() {
  const w = gameBoard.offsetWidth;
  const h = gameBoard.offsetHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// --- Socket通信イベントハンドリング ---
socket.on('lobby-chat-message', (data) => appendChatMessage(lobbyChatBox, data));

// --- 修正：チャット受信時にエモートかどうかを判定 ---
socket.on('chat-message', (data) => {
  if (data.message.startsWith('[EMOTE]')) {
    const emoteText = data.message.replace('[EMOTE]', '');
    showEmoteSplash(emoteText, data.role); // ド派手に表示！
    data.message = `📢 ${emoteText}`; // チャット履歴にも残す
    appendChatMessage(roomChatBox, data);
  } else {
    appendChatMessage(roomChatBox, data);
  }
});

// --- 新規追加：エモートのド派手表示関数 ---
function showEmoteSplash(text, role) {
  const splash = document.createElement('div');
  splash.className = 'emote-text-splash';
  splash.textContent = text;

  // 送信者のロールに合わせて文字色を変更
  if (role === 'X') splash.style.color = '#ff4757';
  else if (role === 'O') splash.style.color = '#1e90ff';
  else splash.style.color = '#747d8c';

  gameBoard.appendChild(splash);

  // アニメーションが終わる1.5秒後にDOMから削除して重くならないようにする
  setTimeout(() => {
    if (splash.parentNode) splash.parentNode.removeChild(splash);
  }, 1500);
}

socket.on('room-list', (rooms) => {
  roomListDiv.innerHTML = '';
  if (rooms.length === 0) {
    roomListDiv.innerHTML = '<p style="color: #a4b0be; font-size:0.9em;">オープンな待機部屋はありません。</p>';
    return;
  }
  rooms.forEach(room => {
    const card = document.createElement('div');
    card.classList.add('room-card');
    if (room.playerCount >= 2) card.classList.add('full');

    let detail = `(${room.playerCount}/2人)`;
    if (room.winner) detail += ' [終了済]';

    const info = document.createElement('span');
    info.textContent = `${room.name} ${detail}`;

    const btn = document.createElement('button');
    if (room.playerCount >= 2) {
      btn.textContent = '観戦する';
      btn.classList.add('spectate-btn');
    } else {
      btn.textContent = '参戦する';
      btn.classList.add('join-btn');
    }

    btn.disabled = isClassTimeLocal && room.playerCount < 2;
    btn.addEventListener('click', () => socket.emit('join-room', room.id));

    card.appendChild(info);
    card.appendChild(btn);
    roomListDiv.appendChild(card);
  });
});

socket.on('leaderboard-update', (data) => {
  leaderboardBody.innerHTML = '';
  data.sort((a, b) => b.totalWins - a.totalWins);
  data.forEach((user, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${index + 1}</strong></td>
      <td>${user.nickname}</td>
      <td style="color:#2ed573;font-weight:bold;">${user.totalWins}</td>
      <td style="color:#ff4757;">${user.totalLosses}</td>
      <td>${user.totalDraws}</td>
      <td>${user.wins}</td>
      <td>${user.losses}</td>
      <td>${user.defaultWins}</td>
      <td>${user.defaultLosses}</td>
    `;
    leaderboardBody.appendChild(tr);
  });
});

socket.on('sync-stats', (serverStats) => {
  Object.assign(myUser, serverStats);
  updateUserDisplay();
});

socket.on('joined-room', (data) => {
  currentRoomId = data.roomId;
  myRole = data.role;
  roomPlayers = data.players;
  currentWinner = data.winner;
  lobbyContainer.style.display = 'none';
  gameContainer.style.display = 'block';
  resizeCanvas();
  updateAvatars();
  renderBoard(data.board, false);
  updateStatus(data.turn, data.winner);
});

socket.on('update-players', (players) => {
roomPlayers = players;

// 【新規追加】試合終了後に対戦プレイヤーが退出した場合、残された側も即座にロビーへ強制退去させる
if (currentRoomId && currentWinner && getActivePlayerCount() < 2) {
alert('対戦プレイヤーが退出したため、部屋が解散されました。');
backBtn.click(); // backBtnの処理を流用してUIをロビーへ戻し、念のためサーバーへもleaveを通知
return; // 以降のアバター更新などを強制ストップ
}

updateAvatars();
updateStatus(roomPlayers[0]?.role || 'X', currentWinner);
});

socket.on('update', (data) => {
  if (!currentRoomId) return;
  currentWinner = null;
  renderBoard(data.board, true);
  updateStatus(data.turn, null);
});

socket.on('win', (data) => {
  if (!currentRoomId) return;
  isPausedByDisconnect = false;
  roomPlayers = data.players;
  currentWinner = data.winnerRole;
  renderBoard(data.board, !data.isDefault);
  updateStatus(null, data.winnerRole, data.isDefault, data.leaverName);
});

socket.on('draw', (data) => {
  if (!currentRoomId) return;
  roomPlayers = data.players;
  currentWinner = 'Draw';
  renderBoard(data.board, true);
  updateStatus(null, 'Draw');
});

// --- 要望要件：不戦勝時にルームが消滅した際の強制退出ハンドリング ---
socket.on('forced-leave', (data) => {
  alert(data.message);
  currentRoomId = '';
  currentWinner = null;
  gameContainer.style.display = 'none';
  lobbyContainer.style.display = 'block';
  roomChatBox.innerHTML = '';
  if (!isClassTimeLocal) hideOverlay();
  isPausedByDisconnect = false;
  updateBackBtnText();
});

socket.on('rematch-voted', (role) => {
  const p = roomPlayers.find(pl => pl.role === role);
  if (myRole !== role && myRole !== 'Spectator' && p) {
    rematchStatus.textContent = `${p.nickname}さんが再戦を希望しています！`;
  }
});

socket.on('rematch-start', (data) => {
  roomPlayers = data.players;
  myRole = roomPlayers.find(p => p.userId === myUser.userId)?.role || 'Spectator';
  currentWinner = null;
  updateAvatars();
  renderBoard(data.board, false);
  updateStatus(data.turn, null);
  rematchArea.style.display = 'none';
  alert('役割を交代して新しい試合を開始します！');
});

socket.on('game-paused', (data) => { 
  isPausedByDisconnect = true; 
  showOverlay(data.message); 
});

socket.on('game-resumed', () => { 
  isPausedByDisconnect = false; 
  if(!isClassTimeLocal) hideOverlay(); 
});

// --- 新規追加：エモートボタンの送信処理 ---
document.querySelectorAll('.emote-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // 観戦者やエラー時、未接続時は押せないようにブロック
    if (!currentRoomId || myRole === 'Spectator' || isPausedByDisconnect || isClassTimeLocal) return;

    const emoteMsg = btn.getAttribute('data-emote');
    // 既存のチャット機能をハックして、先頭に [EMOTE] という目印をつけてサーバーに送る
    socket.emit('chat-message', { roomId: currentRoomId, message: `[EMOTE]${emoteMsg}` });
  });
});

// --- アニメーションループ（物理挙動・重力） ---
const gravity = -0.012; 
const bounce = -0.35;    

function animate() {
  requestAnimationFrame(animate);

  pieceMeshes.forEach(piece => {
    if (piece && piece.userData.isFalling && !isPausedByDisconnect && !isClassTimeLocal) {
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
animate();
window.addEventListener('resize', resizeCanvas);