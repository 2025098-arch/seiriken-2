import { 
  initConnect4, 
  updateAvatars3D, 
  renderBoard3D, 
  resetBoard3D, 
  showEmoteSplash3D, 
  resizeCanvas3D 
} from './3Dconnect4.js';

// ここでグローバルに io() が使える前提（HTML側でsocket.io.jsを読み込んでいること）
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

const emergencyBypassBtn = document.getElementById('emergency-bypass-btn');

// --- 状態管理変数 ---
let myUser = null; 
let myRole = '';
let currentRoomId = '';
let roomPlayers = []; 

let isRegisterMode = false;
let isClassTimeLocal = false; 
let isPausedByDisconnect = false;
let currentWinner = null; 
let currentTurn = 'X'; 
let lastEmoteTime = 0; 

// 3Dconnect4.js 側に状態を渡すためのゲッター関数
const getGameState = () => ({
  myRole,
  currentRoomId,
  roomPlayers,
  isClassTimeLocal,
  isPausedByDisconnect
});

// 立体四目の初期化
initConnect4(socket, getGameState);

// --- ヘルパー関数 ---
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

// --- 退出ボタン表記の動的切り替えロジック ---
function updateBackBtnText() {
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
      eyeColor: document.getElementById('icon-eye-color').value,
      mouth: document.getElementById('icon-mouth').value, 
      mouthColor: document.getElementById('icon-mouth-color').value,
      beard: document.getElementById('icon-beard').value
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
    eyeColor: document.getElementById('set-eye-color').value,
    mouth: document.getElementById('set-mouth').value,
    mouthColor: document.getElementById('set-mouth-color').value,
    beard: document.getElementById('set-beard').value
  };
  socket.emit('update-profile', { newNickname, oldPassword, newPassword, icon });
});

function updateUserDisplay() {
  userInfo.innerHTML = `ユーザー: <strong>${myUser.nickname || '不明'}</strong> | 
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

if (emergencyBypassBtn) {
  emergencyBypassBtn.addEventListener('click', () => {
    const confirmed = confirm(
      "【最終確認】\n本当に現在の時限のロックを解除しますか？\n" +
      "※実際の休み時間や放課後なのにサーバーがロックされている場合のみ使用してください。\n" +
      "※授業中に嘘の解除を行った場合の責任は一切負いません。"
    );
    if (confirmed) socket.emit('emergency-bypass-class');
  });
}

function updateStatus(turn, winnerRole, isDefault = false, leaverName = '') {
  const currentPlayers = getActivePlayerCount();
  currentWinner = winnerRole; 

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
    const winnerName = p ? (p.nickname || p.role) : winnerRole;

    if (isDefault) {
      statusDiv.textContent = `不戦勝！ ${leaverName || '相手'}が退出したため、${winnerName} の勝利です！ 🎉`;
    } else {
      statusDiv.textContent = `${winnerName} の勝利です！ 🎉`;
    }
    statusDiv.style.color = winnerRole === 'X' ? '#ff4757' : '#1e90ff';
  } else {
    rematchArea.style.display = 'none';
    const p = roomPlayers.find(pl => pl.role === turn);
    const turnName = p ? (p.nickname || p.role) : turn;

    if (myRole === 'Spectator') {
      statusDiv.textContent = `観戦中 (ターン: ${turnName})`;
    } else {
      statusDiv.textContent = turn === myRole ? 'あなたのターンです！' : `${turnName}の思考中...`;
    }
    statusDiv.style.color = turn === 'X' ? '#ff4757' : '#1e90ff';
  }

  updateBackBtnText(); 
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
  nameEl.textContent = (data.nickname || '不明なユーザー') + ': ';

  const textEl = document.createTextNode(data.message);
  msgEl.appendChild(nameEl);
  msgEl.appendChild(textEl);
  box.appendChild(msgEl);

  requestAnimationFrame(() => {
    box.scrollTop = box.scrollHeight;
  });
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
  currentTurn = 'X'; 
  gameContainer.style.display = 'none';
  lobbyContainer.style.display = 'block';
  roomChatBox.innerHTML = '';

  rematchArea.style.display = 'none';
  rematchBtn.style.display = 'inline-block';
  openSettingsBtn.style.display = 'block'; 

  // 3D側のボードとアバターをリセット
  resetBoard3D();
});

rematchBtn.addEventListener('click', () => {
  socket.emit('rematch', currentRoomId);
  rematchBtn.style.display = 'none';
  rematchStatus.textContent = '相手の同意を待っています...';
});

// --- Socket通信イベントハンドリング ---
socket.on('lobby-chat-message', (data) => appendChatMessage(lobbyChatBox, data));

socket.on('chat-message', (data) => {
  if (data.message.startsWith('[EMOTE]')) {
    const emoteText = data.message.replace('[EMOTE]', '');
    showEmoteSplash3D(emoteText, data.role); // 3D側にド派手表示を依頼
    data.message = `📢 ${emoteText}`; 
    appendChatMessage(roomChatBox, data);
  } else {
    appendChatMessage(roomChatBox, data);
  }
});

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
  data.slice(0, 100).forEach((user, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${index + 1}</strong></td>
      <td>${user.nickname || '不明'}</td>
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
  currentTurn = data.turn; 

  lobbyContainer.style.display = 'none';
  gameContainer.style.display = 'block';
  openSettingsBtn.style.display = 'none'; 

  resizeCanvas3D();
  updateAvatars3D();
  renderBoard3D(data.board, false);
  updateStatus(currentTurn, data.winner);
});

socket.on('update-players', (players) => {
  roomPlayers = players;

  if (currentRoomId && currentWinner && getActivePlayerCount() < 2) {
    alert('対戦プレイヤーが退出したため、部屋が解散されました。');
    backBtn.click(); 
    return; 
  }

  updateAvatars3D();
  updateStatus(currentTurn, currentWinner); 
});

socket.on('update', (data) => {
  if (!currentRoomId) return;
  currentWinner = null;
  currentTurn = data.turn; 
  renderBoard3D(data.board, true);
  updateStatus(currentTurn, null);
});

socket.on('win', (data) => {
  if (!currentRoomId) return;
  isPausedByDisconnect = false;
  roomPlayers = data.players;
  currentWinner = data.winnerRole;
  renderBoard3D(data.board, !data.isDefault);
  updateStatus(currentTurn, data.winnerRole, data.isDefault, data.leaverName);
});

socket.on('draw', (data) => {
  if (!currentRoomId) return;
  roomPlayers = data.players;
  currentWinner = 'Draw';
  renderBoard3D(data.board, true);
  updateStatus(currentTurn, 'Draw');
});

socket.on('forced-leave', (data) => {
  alert(data.message);
  currentRoomId = '';
  currentWinner = null;
  currentTurn = 'X';
  gameContainer.style.display = 'none';
  lobbyContainer.style.display = 'block';
  roomChatBox.innerHTML = '';

  rematchArea.style.display = 'none';
  rematchBtn.style.display = 'inline-block';
  openSettingsBtn.style.display = 'block'; 

  resetBoard3D();

  if (!isClassTimeLocal) hideOverlay();
  isPausedByDisconnect = false;
  updateBackBtnText();
});

socket.on('rematch-voted', (role) => {
  const p = roomPlayers.find(pl => pl.role === role);
  if (myRole !== role && myRole !== 'Spectator' && p) {
    rematchStatus.textContent = `${p.nickname || p.role}さんが再戦を希望しています！`;
  }
});

socket.on('rematch-start', (data) => {
  roomPlayers = data.players;
  myRole = roomPlayers.find(p => p.userId === myUser.userId)?.role || 'Spectator';
  currentWinner = null;
  currentTurn = data.turn; 
  updateAvatars3D();
  renderBoard3D(data.board, false);
  updateStatus(currentTurn, null);
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

// --- エモートボタンの送信処理（制限機能付き） ---
document.querySelectorAll('.emote-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!currentRoomId || myRole === 'Spectator' || isPausedByDisconnect || isClassTimeLocal) return;

    if (getActivePlayerCount() < 2) {
      alert('対戦相手が揃うまでエモートは使用できません。');
      return;
    }

    const now = Date.now();
    if (now - lastEmoteTime < 10000) {
      const remain = Math.ceil((10000 - (now - lastEmoteTime)) / 1000);
      alert(`エモートは連続で使用できません。あと ${remain} 秒お待ちください。`);
      return;
    }
    lastEmoteTime = now;

    const emoteMsg = btn.getAttribute('data-emote');
    socket.emit('chat-message', { roomId: currentRoomId, message: `[EMOTE]${emoteMsg}` });
  });
});