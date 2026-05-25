const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  trustProxy: true
});

app.set('trust proxy', true);
app.use(express.static('public'));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB successfully.'))
  .catch(err => console.error('MongoDB connection error:', err));

// --- 管理者用のシークレットキー ---
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'my-super-secret-lock-2026';

// --- データベース設計 ---
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true }, 
  nickname: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  icon: { type: mongoose.Schema.Types.Mixed },
  ipAddress: { type: String, required: true }, 
  totalWins: { type: Number, default: 0 },
  totalLosses: { type: Number, default: 0 },
  totalDraws: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  defaultWins: { type: Number, default: 0 },
  defaultLosses: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);

let rooms = {};

// --- 【新規追加】緊急解除（バイパス）された時限を記憶する変数 ---
let bypassedPeriod = null; 

// --- 【リファクタリング】海外サーバー対応のタイムゾーン・2026年祝日・時限特定ロジック ---
function getCurrentPeriod() {
  // サーバーのローカル時間に依存せず、確実に日本時間を計算 (UTC + 9時間)
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const jstNow = new Date(utc + (3600000 * 9));

  const day = jstNow.getDay();
  if (day === 0) return null; // 日曜日は授業なし

  const mmdd = String(jstNow.getMonth() + 1).padStart(2, '0') + '-' + String(jstNow.getDate()).padStart(2, '0');

  // 2026年（現在の年）の日本の祝日・振替休日データに完全準拠
  const holidays = [
    "01-01", "01-12", "02-11", "02-23", "03-20", "04-29", "05-03", 
    "05-04", "05-05", "05-06", "07-20", "08-11", "08-12", "09-21", 
    "09-22", "09-23", "10-12", "11-03", "11-23", "11-24"
  ];
  if (holidays.includes(mmdd)) return null;

  const mins = jstNow.getHours() * 60 + jstNow.getMinutes();

  // 各時限の判定（細かかった分岐をここで一元管理）
  if (mins >= 8 * 60 + 50 && mins < 9 * 60 + 40) return 'p1';
  if (mins >= 9 * 60 + 50 && mins < 10 * 60 + 40) return 'p2';
  if (mins >= 10 * 60 + 50 && mins < 11 * 60 + 40) return 'p3';

  // 土曜日は3限まで
  if (day === 6) return null;

  if (mins >= 12 * 60 + 45 && mins < 13 * 60 + 35) return 'p4';
  if (mins >= 13 * 60 + 45 && mins < 14 * 60 + 35) return 'p5';
  if (mins >= 14 * 60 + 45 && mins < 15 * 60 + 35) return 'p6';

  return null; 
}

let isCurrentlyClassTime = false;

// 授業中モードの監視タイマー（3秒に高速化されたものを維持）
setInterval(() => {
  const currentPeriod = getCurrentPeriod(); // 今が何限目かを取得 ('p1'~'p6' または null)

  // 【自動リセット】もし次の時限に移った、または休み時間・放課後になったら緊急解除を自動で消去
  if (currentPeriod !== bypassedPeriod) {
    bypassedPeriod = null; 
  }

  // 「今が授業時間」かつ「その時限が緊急解除されていない」場合のみ、真の授業中(true)と判定
  const currentClassStatus = (currentPeriod !== null) && (currentPeriod !== bypassedPeriod);

  if (currentClassStatus !== isCurrentlyClassTime) {
    isCurrentlyClassTime = currentClassStatus;
    io.emit('schedule-status', isCurrentlyClassTime);

    if (isCurrentlyClassTime) {
      Object.keys(rooms).forEach(roomId => {
        const room = rooms[roomId];
        if (!room.winner) {
          room.isClassPaused = true;
          io.to(roomId).emit('game-paused', { reason: 'classTime', message: '授業が始まりました。ゲームは一時停止されます。終了後に再開可能です。' });
        }
      });
    } else {
      Object.keys(rooms).forEach(roomId => {
        const room = rooms[roomId];
        if (room.isClassPaused) {
          room.isClassPaused = false;
          io.to(roomId).emit('game-resumed');

          room.players.forEach(p => {
            if (p.role !== 'Spectator') {
              // 【AI対応】AIプレイヤーはソケットを持たないため、誤判定による不戦勝タイマーの起動を防ぐ
              if (room.isAiRoom && p.role === 'O') return;

              const socketExists = io.sockets.sockets.get(p.id);
              if (!socketExists) {
                io.to(roomId).emit('game-paused', { reason: 'disconnect', message: '対戦相手の通信が切断されています。復帰を待っています...(60秒後に不戦勝)' });

                if (room.disconnectTimers && room.disconnectTimers[p.userId]) {
                  clearTimeout(room.disconnectTimers[p.userId]);
                }

                room.disconnectTimers = room.disconnectTimers || {};
                room.disconnectTimers[p.userId] = setTimeout(() => {
                  executeDefaultWin(roomId, p.userId).catch(console.error);
                }, 60000);
              }
            }
          });

          // 【AI対応】ロック解除で再開した際、AIのターン（O）であれば自動思考をキック
          if (room.isAiRoom && room.turn === 'O' && !room.winner) {
            setTimeout(() => { makeAiMove(roomId).catch(console.error); }, 800);
          }
        }
      });
    }
  }
}, 3000);

// --- 立体四目並べ 勝利判定ロジック ---
const winLines = [];
for(let i=0; i<4; i++) {
  for(let j=0; j<4; j++) {
    winLines.push([i*16+j*4+0, i*16+j*4+1, i*16+j*4+2, i*16+j*4+3]);
    winLines.push([i*16+0*4+j, i*16+1*4+j, i*16+2*4+j, i*16+3*4+j]);
    winLines.push([0*16+i*4+j, 1*16+i*4+j, 2*16+i*4+j, 3*16+i*4+j]);
  }
  winLines.push([i*16+0, i*16+5, i*16+10, i*16+15]); winLines.push([i*16+3, i*16+6, i*16+9, i*16+12]);
  winLines.push([0*16+i*4+0, 1*16+i*4+1, 2*16+i*4+2, 3*16+i*4+3]); winLines.push([0*16+i*4+3, 1*16+i*4+2, 2*16+i*4+1, 3*16+0*4+i]);
  winLines.push([0*16+0*4+i, 1*16+1*4+i, 2*16+2*4+i, 3*16+3*4+i]); winLines.push([0*16+3*4+i, 1*16+2*4+i, 2*16+1*4+i, 3*16+0*4+i]);
}
winLines.push([0, 21, 42, 63]); winLines.push([3, 22, 41, 60]);
winLines.push([12, 25, 38, 51]); winLines.push([15, 26, 37, 48]);

function checkWin(board, role) { return winLines.some(l => l.every(idx => board[idx] === role)); }
function checkDraw(board) { return board.every(c => c !== null); }

// --- 【新規追加】AI（CPU）の思考・配置ロジック ---
async function makeAiMove(roomId) {
  const room = rooms[roomId];
  // 部屋がない、既に決着している、授業中ロックされている、AIのターンでない場合は即座に弾く
  if (!room || room.winner || isCurrentlyClassTime || room.isClassPaused || room.turn !== 'O') return;

  // 16本のペグ（縦棒）のうち、まだ4つ埋まっていない有効な選択肢をリストアップ
  const validMoves = [];
  for (let peg = 0; peg < 16; peg++) {
    let z = -1;
    for (let i = 0; i < 4; i++) {
      if (!room.board[i * 16 + peg]) { z = i; break; }
    }
    if (z !== -1) {
      validMoves.push({ peg, z, boardIdx: z * 16 + peg });
    }
  }

  if (validMoves.length === 0) return;

  let selectedMove = null;

  // 【思考段階 1】自分がこの一手で勝てる（王手）マスがあるかシミュレート
  for (const move of validMoves) {
    const tempBoard = [...room.board];
    tempBoard[move.boardIdx] = 'O';
    if (checkWin(tempBoard, 'O')) {
      selectedMove = move;
      break;
    }
  }

  // 【思考段階 2】相手が次の手で勝ってしまう（防塞すべき）マスがあるかシミュレート
  if (!selectedMove) {
    for (const move of validMoves) {
      const tempBoard = [...room.board];
      tempBoard[move.boardIdx] = 'X';
      if (checkWin(tempBoard, 'X')) {
        selectedMove = move;
        break;
      }
    }
  }

  // 【思考段階 3】上記に該当しなければ、有効なマスからランダムに選択
  if (!selectedMove) {
    const randomIdx = Math.floor(Math.random() * validMoves.length);
    selectedMove = validMoves[randomIdx];
  }

  // コマを配置
  room.board[selectedMove.boardIdx] = 'O';

  try {
    if (checkWin(room.board, 'O')) {
      room.winner = 'O';
      const p = room.players.find(pl => pl.role === 'X'); // プレイヤー

      let lStats = null;
      if (p) {
        const loserStats = await User.findOne({ userId: p.userId });
        if (loserStats) {
          loserStats.losses++; loserStats.totalLosses++;
          await loserStats.save();
          lStats = loserStats;
          io.to(p.id).emit('sync-stats', loserStats);
        }
      }

      await broadcastState();

      io.to(roomId).emit('win', {
        winnerRole: 'O',
        board: room.board,
        players: room.players,
        isDefault: false,
        updatedStats: { winner: null, loser: lStats }
      });

    } else if (checkDraw(room.board)) {
      room.winner = 'Draw';
      const p = room.players.find(pl => pl.role === 'X');
      let drawStatsList = [];

      if (p) {
        const st = await User.findOne({ userId: p.userId });
        if (st) {
          st.totalDraws++;
          await st.save();
          drawStatsList.push(st);
          io.to(p.id).emit('sync-stats', st);
        }
      }

      await broadcastState();

      io.to(roomId).emit('draw', {
        board: room.board,
        players: room.players,
        updatedStats: drawStatsList
      });

    } else {
      room.turn = 'X';
      io.to(roomId).emit('update', { board: room.board, turn: room.turn });
    }
  } catch (err) {
    console.error('AI Move processing error:', err);
  }
}

// --- パスワードを除外し、上位100名のみを安全にブロードキャスト ---
async function broadcastState() {
  try {
    const leaderboardUsers = await User.find({})
      .select('-password') 
      .sort({ totalWins: -1 })
      .limit(100); 

    io.emit('room-list', Object.keys(rooms).map(id => ({ 
      id, 
      name: rooms[id].name, 
      playerCount: rooms[id].players.filter(p => p.role !== 'Spectator').length, 
      winner: rooms[id].winner 
    })));
    io.emit('leaderboard-update', leaderboardUsers);
  } catch (err) {
    console.error('Error in broadcastState:', err);
  }
}

// --- 堅牢な例外・解散処理（ゾンビ部屋の完全排除） ---
async function executeDefaultWin(roomId, leaverUserId) {
  const room = rooms[roomId];
  if (!room || room.winner) return;

  const activePlayers = room.players.filter(p => p.role === 'X' || p.role === 'O');
  if (activePlayers.length < 2) return;

  const leavingPlayer = room.players.find(p => p.userId === leaverUserId);
  const leavingPlayerRole = leavingPlayer?.role;
  if (!leavingPlayerRole || leavingPlayerRole === 'Spectator') return;

  const opponentRole = leavingPlayerRole === 'X' ? 'O' : 'X';
  const remainingOpponent = room.players.find(p => p.role === opponentRole);

  room.winner = opponentRole;
  let updatedOpponentStats = null;

  try {
    const leaverStats = await User.findOne({ userId: leaverUserId });
    if (leaverStats) {
      leaverStats.defaultLosses += 1;
      leaverStats.totalLosses += 1;
      await leaverStats.save();
    }

    if (remainingOpponent) {
      const opponentStats = await User.findOne({ userId: remainingOpponent.userId });
      if (opponentStats) {
        opponentStats.defaultWins += 1;
        opponentStats.totalWins += 1;
        await opponentStats.save();
        updatedOpponentStats = opponentStats;
        io.to(remainingOpponent.id).emit('sync-stats', opponentStats);
      }
    }
  } catch (err) {
    console.error('DB Update Error in executeDefaultWin:', err);
  } finally {
    if (room.disconnectTimers) {
      Object.values(room.disconnectTimers).forEach(timer => clearTimeout(timer));
    }

    io.to(roomId).emit('win', { 
      winnerRole: opponentRole, 
      board: room.board, 
      players: room.players, 
      isDefault: true, 
      leaverName: leavingPlayer ? leavingPlayer.nickname : "対戦相手",
      updatedStats: updatedOpponentStats 
    });

    io.to(roomId).emit('forced-leave', { message: '不戦勝・不戦敗が確定したため、この部屋は自動的に解散されました。' });

    const ioRoom = io.sockets.adapter.rooms.get(roomId);
    if (ioRoom) {
      Array.from(ioRoom).forEach(id => {
        const s = io.sockets.sockets.get(id);
        if (s) s.leave(roomId);
      });
    }

    delete rooms[roomId];
    await broadcastState();
  }
}

// --- Socket.io 通信部 ---
io.on('connection', (socket) => {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  let clientIp = socket.handshake.address;
  if (forwarded) {
    clientIp = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim();
  }

  socket.emit('schedule-status', isCurrentlyClassTime);

  // アカウント新規登録
  socket.on('register', async (data) => {
    try {
      const existingUser = await User.findOne({ nickname: data.nickname });
      if (existingUser) return socket.emit('auth-error', 'このニックネームは既に使われています。');

      const userId = Math.random().toString(36).substring(2) + Date.now();
      const newUser = new User({
        userId, 
        nickname: data.nickname, 
        password: data.password, 
        icon: data.icon,
        ipAddress: clientIp, 
        totalWins: 0, totalLosses: 0, totalDraws: 0, wins: 0, losses: 0, defaultWins: 0, defaultLosses: 0
      });

      await newUser.save();

      socket.userId = userId; socket.nickname = data.nickname; socket.icon = data.icon;
      socket.emit('auth-success', newUser);
      await broadcastState();
    } catch (err) {
      console.error('Register error:', err);
      socket.emit('auth-error', 'サーバーエラーにより登録に失敗しました。');
    }
  });

  // ログイン
  socket.on('login', async (data) => {
    try {
      const user = await User.findOne({ nickname: data.nickname });
      if (!user || user.password !== data.password) return socket.emit('auth-error', '名前かパスワードが間違っています。');

      socket.userId = user.userId; socket.nickname = user.nickname; socket.icon = user.icon;
      socket.emit('auth-success', user);

      Object.keys(rooms).forEach(roomId => {
        const room = rooms[roomId];
        const p = room.players.find(pl => pl.userId === user.userId);
        if (p) {
          p.id = socket.id; p.icon = user.icon;
          socket.join(roomId);

          if (room.disconnectTimers && room.disconnectTimers[user.userId]) {
            clearTimeout(room.disconnectTimers[user.userId]);
            delete room.disconnectTimers[user.userId];
          }

          socket.emit('joined-room', { roomId, role: p.role, board: room.board, turn: room.turn, winner: room.winner, players: room.players });

          io.to(roomId).emit('chat-message', { nickname: 'システム', role: '通知', message: `${user.nickname} がゲームに復帰しました！` });

          if (!isCurrentlyClassTime && room.isClassPaused) {
             room.isClassPaused = false;
          }

          if (!isCurrentlyClassTime && !room.isClassPaused) {
             io.to(roomId).emit('game-resumed');

             // 【AI対応】復帰時にAI部屋かつAIのターンであれば、即座に思考プロセスを再開
             if (room.isAiRoom && room.turn === 'O' && !room.winner) {
               setTimeout(() => { makeAiMove(roomId).catch(console.error); }, 800);
             }
          } else {
             socket.emit('game-paused', { reason: 'classTime', message: '授業中のため、ゲームは一時停止されています。' });
          }
          io.to(roomId).emit('update-players', room.players);
        }
      });
      await broadcastState();
    } catch (err) {
      console.error('Login error:', err);
      socket.emit('auth-error', 'サーバーエラーによりログインに失敗しました。');
    }
  });

  // プロフィール更新
  socket.on('update-profile', async (data) => {
    try {
      if (!socket.userId) return socket.emit('auth-error', 'セッションが切れています。再度ログインしてください。');

      const user = await User.findOne({ userId: socket.userId });
      if (!user || user.password !== data.oldPassword) return socket.emit('auth-error', '現在のパスワードが違います。');

      if (data.newNickname !== user.nickname) {
        const existingNewUser = await User.findOne({ nickname: data.newNickname });
        if (existingNewUser) return socket.emit('auth-error', 'その新しいニックネームは既に使われています。');
      }

      user.icon = data.icon;
      user.password = data.newPassword || user.password;
      user.nickname = data.newNickname;

      await user.save();

      socket.nickname = data.newNickname;
      socket.icon = data.icon;
      socket.emit('auth-success', user);

      Object.keys(rooms).forEach(roomId => {
        const p = rooms[roomId].players.find(pl => pl.id === socket.id);
        if(p) { p.nickname = socket.nickname; p.icon = socket.icon; io.to(roomId).emit('update-players', rooms[roomId].players); }
      });
      await broadcastState();
    } catch (err) {
      console.error('Profile update error:', err);
      socket.emit('auth-error', 'サーバーエラーによりプロフィール更新に失敗しました。');
    }
  });

  // チャット
  socket.on('chat-message', ({ roomId, message }) => {
    if (!socket.nickname) return;

    if (roomId && rooms[roomId]) {
      const p = rooms[roomId].players.find(pl => pl.id === socket.id);
      io.to(roomId).emit('chat-message', { nickname: socket.nickname, role: p ? (p.role==='Spectator'?'観戦':p.role) : '??', message });
    } else {
      io.emit('lobby-chat-message', { nickname: socket.nickname, message });
    }
  });

  // 部屋作成（通常対人戦）
  socket.on('create-room', (name) => {
    if (!socket.nickname || !socket.userId) return socket.emit('auth-error', 'セッションが切れています。再度ログインしてください。');

    if (isCurrentlyClassTime) {
      return socket.emit('auth-error', '現在は授業時間中のため、新しく部屋を作成することはできません。');
    }
    const roomId = Math.random().toString(36).substring(7);
    rooms[roomId] = { name: name || `${socket.nickname}の部屋`, board: Array(64).fill(null), turn: 'X', players: [{ id: socket.id, userId: socket.userId, nickname: socket.nickname, icon: socket.icon, role: 'X' }], winner: null, rematchVotes: [], disconnectTimers: {}, isClassPaused: false };
    socket.join(roomId);
    socket.emit('joined-room', { roomId, role: 'X', board: rooms[roomId].board, turn: 'X', players: rooms[roomId].players });
    broadcastState();
  });

  // --- 【新規追加】AI（CPU）対戦部屋作成 ---
  socket.on('create-ai-room', (name) => {
    if (!socket.nickname || !socket.userId) return socket.emit('auth-error', 'セッションが切れています。再度ログインしてください。');

    if (isCurrentlyClassTime) {
      return socket.emit('auth-error', '現在は授業時間中のため、新しく部屋を作成することはできません。');
    }
    const roomId = Math.random().toString(36).substring(7);
    rooms[roomId] = { 
      name: name || `${socket.nickname}のCPU対戦部屋`, 
      board: Array(64).fill(null), 
      turn: 'X', 
      players: [
        { id: socket.id, userId: socket.userId, nickname: socket.nickname, icon: socket.icon, role: 'X' },
        { id: 'ai-socket-id', userId: 'ai-user-id', nickname: 'CPU（AI）', icon: '🤖', role: 'O' }
      ], 
      winner: null, 
      rematchVotes: [], 
      disconnectTimers: {}, 
      isClassPaused: false,
      isAiRoom: true // AI部屋であることを識別するフラグ
    };
    socket.join(roomId);
    socket.emit('joined-room', { roomId, role: 'X', board: rooms[roomId].board, turn: 'X', players: rooms[roomId].players });
    broadcastState();
  });

  // 部屋参加
  socket.on('join-room', (roomId) => {
    if (!socket.nickname || !socket.userId) return socket.emit('auth-error', 'セッションが切れています。再度ログインしてください。');

    if (isCurrentlyClassTime) {
      return socket.emit('auth-error', '現在は授業時間中のため、部屋に参加することはできません。');
    }
    const room = rooms[roomId];
    if (!room) return;

    const isAlreadyInRoom = room.players.some(p => p.userId === socket.userId);
    if (isAlreadyInRoom) {
      return socket.emit('auth-error', 'すでにこの部屋に参加しています。（自分との対戦はできません）');
    }

    const current = room.players.filter(p => p.role !== 'Spectator');
    let role = 'Spectator';
    if (current.length < 2) role = current.length === 0 ? 'X' : (current[0].role === 'X' ? 'O' : 'X');
    room.players.push({ id: socket.id, userId: socket.userId, nickname: socket.nickname, icon: socket.icon, role });
    socket.join(roomId);
    io.to(roomId).emit('update-players', room.players);
    socket.emit('joined-room', { roomId, role, board: room.board, turn: room.turn, winner: room.winner, players: room.players });
    broadcastState();
  });

  // コマ配置
  socket.on('move', async ({ roomId, pegIndex }) => {
    if (!socket.userId) return;

    const room = rooms[roomId];
    if (!room || room.winner || isCurrentlyClassTime || room.isClassPaused) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (!p || p.role !== room.turn || room.players.filter(pl => pl.role !== 'Spectator').length < 2) return;

    let z = -1;
    for(let i=0; i<4; i++) { if(!room.board[i*16 + pegIndex]) { z = i; break; } }
    if (z !== -1) {
      room.board[z * 16 + pegIndex] = p.role;
      try {
        if (checkWin(room.board, p.role)) {
          room.winner = p.role;
          const op = room.players.find(pl => pl.role === (p.role === 'X' ? 'O' : 'X'));

          let wStats = null;
          let lStats = null;

          const winnerStats = await User.findOne({ userId: p.userId });
          if (winnerStats) { 
            winnerStats.wins++; winnerStats.totalWins++; 
            await winnerStats.save(); 
            wStats = winnerStats;
            io.to(p.id).emit('sync-stats', winnerStats); 
          }

          if (op) {
            const loserStats = await User.findOne({ userId: op.userId });
            if (loserStats) { 
              loserStats.losses++; loserStats.totalLosses++; 
              await loserStats.save(); 
              lStats = loserStats;
              io.to(op.id).emit('sync-stats', loserStats); 
            }
          }

          await broadcastState();

          io.to(roomId).emit('win', { 
            winnerRole: p.role, 
            board: room.board, 
            players: room.players, 
            isDefault: false,
            updatedStats: { winner: wStats, loser: lStats }
          });

        } else if (checkDraw(room.board)) {
          room.winner = 'Draw';
          const activePlayers = room.players.filter(pl => pl.role !== 'Spectator');
          let drawStatsList = [];

          for (const pl of activePlayers) {
            const st = await User.findOne({ userId: pl.userId });
            if (st) { 
              st.totalDraws++; 
              await st.save(); 
              drawStatsList.push(st);
              io.to(pl.id).emit('sync-stats', st); 
            }
          }

          await broadcastState();

          io.to(roomId).emit('draw', { 
            board: room.board, 
            players: room.players,
            updatedStats: drawStatsList
          });

        } else {
          room.turn = room.turn === 'X' ? 'O' : 'X';
          io.to(roomId).emit('update', { board: room.board, turn: room.turn });

          // 【AI対応】AI部屋であり、プレイヤー（X）の着手が正常完了し、AIのターン（O）になった場合は0.8秒後に自動思考
          if (room.isAiRoom && room.turn === 'O' && !room.winner && !isCurrentlyClassTime && !room.isClassPaused) {
            setTimeout(() => {
              makeAiMove(roomId).catch(console.error);
            }, 800);
          }
        }
      } catch (err) {
        console.error('Move processing error:', err);
      }
    }
  });

  // リマッチ
  socket.on('rematch', (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.winner || isCurrentlyClassTime) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (p && p.role !== 'Spectator' && !room.rematchVotes.includes(p.role)) {
      room.rematchVotes.push(p.role);

      // 【AI対応】AI対戦部屋であれば、プレイヤーの投票（1つ目）を確認した時点でAIの同意票（O）を自動注入して即時合意させる
      if (room.isAiRoom && room.rematchVotes.length === 1) {
        room.rematchVotes.push('O');
      }

      if (room.rematchVotes.length === 2) {
        room.board = Array(64).fill(null); 
        room.turn = 'X'; 
        room.winner = null; 
        room.rematchVotes = [];
        io.to(roomId).emit('rematch-start', { board: room.board, turn: room.turn, players: room.players });
        broadcastState();
      } else {
        io.to(roomId).emit('rematch-voted', p.role);
      }
    }
  });

  // 部屋退室
  socket.on('leave-room', async (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    const p = room.players.find(pl => pl.id === socket.id);
    const activeCount = room.players.filter(pl => pl.role === 'X' || pl.role === 'O').length;

    if (p && p.role !== 'Spectator' && room.winner) {
      if (room.disconnectTimers) {
        Object.values(room.disconnectTimers).forEach(timer => clearTimeout(timer));
      }
      io.to(roomId).emit('forced-leave', { message: '対戦相手が退出したため、この部屋は自動的に解散されました。' });

      const ioRoom = io.sockets.adapter.rooms.get(roomId);
      if (ioRoom) {
        Array.from(ioRoom).forEach(id => {
          const s = io.sockets.sockets.get(id);
          if (s) s.leave(roomId);
        });
      }
      delete rooms[roomId];
      await broadcastState();
      return; 
    }

    if (p && p.role !== 'Spectator' && !room.winner && (room.isClassPaused || isCurrentlyClassTime) && activeCount === 2) {
      if (room.disconnectTimers) {
        Object.values(room.disconnectTimers).forEach(timer => clearTimeout(timer));
      }
      io.to(roomId).emit('forced-leave', { message: '授業中にプレイヤーが退出したため、この部屋は自動的に解散されました。' });

      const ioRoom = io.sockets.adapter.rooms.get(roomId);
      if (ioRoom) {
        Array.from(ioRoom).forEach(id => {
          const s = io.sockets.sockets.get(id);
          if (s) s.leave(roomId);
        });
      }
      delete rooms[roomId];
      await broadcastState();
      return; 
    }

    if (p && p.role !== 'Spectator' && !room.winner && !room.isClassPaused && !isCurrentlyClassTime && activeCount === 2) {
      const op = room.players.find(pl => pl.role !== 'Spectator' && pl.id !== socket.id);

      if (op && room.disconnectTimers && room.disconnectTimers[op.userId]) {
        await executeDefaultWin(roomId, op.userId);
      } else {
        await executeDefaultWin(roomId, socket.userId);
      }
    }

    if (rooms[roomId]) {
      rooms[roomId].players = rooms[roomId].players.filter(pl => pl.id !== socket.id);
      socket.leave(roomId);

      if (rooms[roomId].players.length === 0) {
        if (rooms[roomId].disconnectTimers) {
          Object.values(rooms[roomId].disconnectTimers).forEach(timer => clearTimeout(timer));
        }
        delete rooms[roomId];
      } else {
        io.to(roomId).emit('update-players', rooms[roomId].players);
      }
      await broadcastState();
    }
  });

  // 切断処理
  socket.on('disconnect', () => {
    Object.keys(rooms).forEach(roomId => {
      const room = rooms[roomId];
      const p = room.players.find(pl => pl.id === socket.id);

      if (p) {
        const activeCount = room.players.filter(pl => pl.role === 'X' || pl.role === 'O').length;

        if (p.role !== 'Spectator' && room.winner) {
          if (room.disconnectTimers) {
            Object.values(room.disconnectTimers).forEach(timer => clearTimeout(timer));
          }
          io.to(roomId).emit('forced-leave', { message: '対戦相手が退出したため、この部屋は自動的に解散されました。' });

          const ioRoom = io.sockets.adapter.rooms.get(roomId);
          if (ioRoom) {
            Array.from(ioRoom).forEach(id => {
              const s = io.sockets.sockets.get(id);
              if (s) s.leave(roomId);
            });
          }
          delete rooms[roomId];
          broadcastState(); 
          return; 
        }

        if (p.role !== 'Spectator' && !room.winner && activeCount === 2) {
          if (room.isClassPaused || isCurrentlyClassTime) return;

          io.to(roomId).emit('game-paused', { reason: 'disconnect', message: '対戦相手の通信が切断されました。復帰を待っています...(60秒後に不戦勝)' });

          if (room.disconnectTimers && room.disconnectTimers[p.userId]) {
            clearTimeout(room.disconnectTimers[p.userId]);
          }

          room.disconnectTimers = room.disconnectTimers || {};
          room.disconnectTimers[p.userId] = setTimeout(() => {
            executeDefaultWin(roomId, p.userId).catch(console.error);
          }, 60000);
        } else {
          room.players = room.players.filter(pl => pl.id !== socket.id);
          if (room.players.length === 0) {
            if (room.disconnectTimers) {
              Object.values(room.disconnectTimers).forEach(timer => clearTimeout(timer));
            }
            delete rooms[roomId];
          } else {
            io.to(roomId).emit('update-players', room.players);
          }
        }
      }
    });
  });

  // --- 【新規追加】授業中ロックの緊急解除（ユーザー自己責任） ---
  socket.on('emergency-bypass-class', () => {
    if (!socket.userId) return socket.emit('auth-error', 'セッションが切れています。再度ログインしてください。');

    const currentPeriod = getCurrentPeriod();
    if (!currentPeriod) {
      return socket.emit('auth-error', '現在は授業時間外のため、制限を解除する必要はありません。');
    }

    // 現在の時限をバイパス(免除)対象として登録
    bypassedPeriod = currentPeriod;
    console.log(`[EMERGENCY] Lock bypassed for ${currentPeriod} by user: ${socket.nickname}`);

    // 次の3秒監視ループを待たずに、即座にサーバー状態を「授業時間外(false)」に反転させ、全ユーザーへ波及・適用する
    const forcedStatus = false;
    if (forcedStatus !== isCurrentlyClassTime) {
      isCurrentlyClassTime = forcedStatus;
      io.emit('schedule-status', isCurrentlyClassTime);

      Object.keys(rooms).forEach(roomId => {
        const room = rooms[roomId];
        if (room.isClassPaused) {
          room.isClassPaused = false;
          io.to(roomId).emit('game-resumed');

          room.players.forEach(p => {
            if (p.role !== 'Spectator') {
              // 【AI対応】AIプレイヤーはソケットを持たないため、ここでも誤判定を確実にガードする
              if (room.isAiRoom && p.role === 'O') return;

              const socketExists = io.sockets.sockets.get(p.id);
              if (!socketExists) {
                io.to(roomId).emit('game-paused', { reason: 'disconnect', message: '対戦相手の通信が切断されています。復帰を待っています...(60秒後に不戦勝)' });
                if (room.disconnectTimers && room.disconnectTimers[p.userId]) {
                  clearTimeout(room.disconnectTimers[p.userId]);
                }
                room.disconnectTimers = room.disconnectTimers || {};
                room.disconnectTimers[p.userId] = setTimeout(() => {
                  executeDefaultWin(roomId, p.userId).catch(console.error);
                }, 60000);
              }
            }
          });

          // 【AI対応】緊急解除で再開した際、AIのターン（O）であれば自動思考をキック
          if (room.isAiRoom && room.turn === 'O' && !room.winner) {
            setTimeout(() => { makeAiMove(roomId).catch(console.error); }, 800);
          }
        }
      });
    }

    // ロビーや部屋チャットに、誰が突破したかをアナウンスして同期させる
    io.emit('lobby-chat-message', { 
      nickname: 'システム通知', 
      message: `⚠️ 【緊急解除】${socket.nickname} さんにより、現在のロック（${currentPeriod}）が免除されました！休み時間扱いになります。` 
    });
  });

  // ==========================================
  // 運営・管理者専用 Socketイベント
  // ==========================================

  // 1. 全ユーザーアカウント一覧の取得
  socket.on('admin-get-users', async (secretKey) => {
    if (secretKey !== ADMIN_SECRET) {
      return socket.emit('admin-error', 'シークレットキーが正しくありません。認証に失敗しました。');
    }
    try {
      const allUsers = await User.find({}).select('-password').sort({ nickname: 1 });
      socket.emit('admin-users-list', allUsers);
    } catch (err) {
      console.error('Admin Fetch Error:', err);
      socket.emit('admin-error', 'ユーザー一覧の取得中にサーバーエラーが発生しました。');
    }
  });

  // 2. 特定のユーザーアカウントの手動削除
  socket.on('admin-delete-user', async ({ secretKey, targetUserId }) => {
    if (secretKey !== ADMIN_SECRET) {
      return socket.emit('admin-error', 'シークレットキーが正しくありません。削除権限がありません。');
    }
    try {
      const targetUser = await User.findOne({ userId: targetUserId });
      if (!targetUser) {
        return socket.emit('admin-error', '指定されたユーザーが見つかりません。すでに削除されている可能性があります。');
      }

      await User.deleteOne({ userId: targetUserId });
      console.log(`[ADMIN] User ${targetUser.nickname} (${targetUserId}) was deleted.`);

      const allUsers = await User.find({}).select('-password').sort({ nickname: 1 });
      socket.emit('admin-users-list', allUsers);

      await broadcastState();
    } catch (err) {
      console.error('Admin Delete Error:', err);
      socket.emit('admin-error', 'ユーザーの削除中にサーバーエラーが発生しました。');
    }
  });

});

server.listen(3000, () => console.log('Server is running on port 3000'));