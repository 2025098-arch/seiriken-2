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

// --- 【新規追加】管理者用のシークレットキー ---
// 環境変数から読み込むか、未設定ならデフォルトの合言葉を使用
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'my-super-secret-lock-2026';

// --- データベース設計 ---
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true }, // 一意性を保証
  nickname: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  icon: { type: mongoose.Schema.Types.Mixed },
  ipAddress: { type: String, required: true }, // 記録用（制約は外す）
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

// --- 【バグ1・2修正】海外サーバー対応の厳格なタイムゾーン・2026年祝日ロジック ---
function checkClassTime() {
  // サーバーのローカル時間に依存せず、確実に日本時間を計算 (UTC + 9時間)
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const jstNow = new Date(utc + (3600000 * 9));

  const day = jstNow.getDay();
  if (day === 0) return false; // 日曜日は授業なし

  const mmdd = String(jstNow.getMonth() + 1).padStart(2, '0') + '-' + String(jstNow.getDate()).padStart(2, '0');

  // 2026年（現在の年）の日本の祝日・振替休日データに完全準拠
  const holidays = [
    "01-01", "01-12", "02-11", "02-23", "03-20", "04-29", "05-03", 
    "05-04", "05-05", "05-06", "07-20", "08-11", "08-12", "09-21", 
    "09-22", "09-23", "10-12", "11-03", "11-23", "11-24"
  ];
  if (holidays.includes(mmdd)) return false;

  const mins = jstNow.getHours() * 60 + jstNow.getMinutes();
  const p1 = mins >= 8 * 60 + 50 && mins < 9 * 60 + 40;
  const p2 = mins >= 9 * 60 + 50 && mins < 10 * 60 + 40;
  const p3 = mins >= 10 * 60 + 50 && mins < 11 * 60 + 40;
  const p4 = mins >= 12 * 60 + 45 && mins < 13 * 60 + 35;
  const p5 = mins >= 13 * 60 + 45 && mins < 14 * 60 + 35;
  const p6 = mins >= 14 * 60 + 45 && mins < 15 * 60 + 35;

  if (day === 6) return p1 || p2 || p3; // 土曜は3限まで
  return p1 || p2 || p3 || p4 || p5 || p6; 
}

let isCurrentlyClassTime = false;
// 【修正】授業中モードの解除を「すぐ」にするため、チェック間隔を10秒から3秒に高速化
setInterval(() => {
  const current = checkClassTime();
  if (current !== isCurrentlyClassTime) {
    isCurrentlyClassTime = current;
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
              const socketExists = io.sockets.sockets.get(p.id);
              if (!socketExists) {
                io.to(roomId).emit('game-paused', { reason: 'disconnect', message: '対戦相手の通信が切断されています。復帰を待っています...(60秒後に不戦勝)' });

                // 【バグ5修正】既存タイマーがあれば必ずクリアして重複を防ぐ
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
  winLines.push([0*16+i*4+0, 1*16+i*4+1, 2*16+i*4+2, 3*16+i*4+3]); winLines.push([0*16+i*4+3, 1*16+i*4+2, 2*16+i*4+1, 3*16+i*4+0]);
  winLines.push([0*16+0*4+i, 1*16+1*4+i, 2*16+2*4+i, 3*16+3*4+i]); winLines.push([0*16+3*4+i, 1*16+2*4+i, 2*16+1*4+i, 3*16+0*4+i]);
}
winLines.push([0, 21, 42, 63]); winLines.push([3, 22, 41, 60]);
winLines.push([12, 25, 38, 51]); winLines.push([15, 26, 37, 48]);

function checkWin(board, role) { return winLines.some(l => l.every(idx => board[idx] === role)); }
function checkDraw(board) { return board.every(c => c !== null); }

// --- 【バグ6修正】パスワードを除外し、上位100名のみを安全にブロードキャスト ---
async function broadcastState() {
  try {
    const leaderboardUsers = await User.find({})
      .select('-password') // パスワードを絶対に送信しない（セキュリティ対策）
      .sort({ totalWins: -1 })
      .limit(100); // 描画パフォーマンスを保護（最大100人）

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

// --- 【バグ4修正】堅牢な例外・解散処理（ゾンビ部屋の完全排除） ---
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
    // 統計データの更新
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
    // 【最重要】DB処理が成功しようが失敗しようが、部屋の解散とタイマークリアは絶対に執行する（finallyブロック）
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
      // 【バグ3修正】学校WiFi対策: 同一IPの完全ブロックを廃止、連続登録アタック（スパム）のみ10秒制限にする等で運用可能。
      // ここでは仕様を削らずバグを回避するため、ニックネーム重複チェックを主軸にする
      const existingUser = await User.findOne({ nickname: data.nickname });
      if (existingUser) return socket.emit('auth-error', 'このニックネームは既に使われています。');

      const userId = Math.random().toString(36).substring(2) + Date.now();
      const newUser = new User({
        userId, 
        nickname: data.nickname, 
        password: data.password, 
        icon: data.icon,
        ipAddress: clientIp, // 記録は残す
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

          // 【バグ5修正】再接続が成功したため、不戦勝タイマーを確実に抹殺する
          if (room.disconnectTimers && room.disconnectTimers[user.userId]) {
            clearTimeout(room.disconnectTimers[user.userId]);
            delete room.disconnectTimers[user.userId];
          }

          socket.emit('joined-room', { roomId, role: p.role, board: room.board, turn: room.turn, winner: room.winner, players: room.players });

          // 【バグ10修正】部屋に残っている対戦相手に、復帰したことをシステムメッセージ等で明示
          io.to(roomId).emit('chat-message', { nickname: 'システム', role: '通知', message: `${user.nickname} がゲームに復帰しました！` });

          if (!isCurrentlyClassTime && room.isClassPaused) {
             room.isClassPaused = false;
          }

          if (!isCurrentlyClassTime && !room.isClassPaused) {
             io.to(roomId).emit('game-resumed');
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

  // 【バグ8修正】一意な userId を使用して確実にプロフィールを特定・更新
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
    // 【修正】undefined名のバグ防止: 認証されていないユーザーのチャットを弾く
    if (!socket.nickname) return;

    if (roomId && rooms[roomId]) {
      const p = rooms[roomId].players.find(pl => pl.id === socket.id);
      io.to(roomId).emit('chat-message', { nickname: socket.nickname, role: p ? (p.role==='Spectator'?'観戦':p.role) : '??', message });
    } else {
      io.emit('lobby-chat-message', { nickname: socket.nickname, message });
    }
  });

  // 部屋作成
  socket.on('create-room', (name) => {
    // 【修正】undefined名のバグ防止
    if (!socket.nickname || !socket.userId) return socket.emit('auth-error', 'セッションが切れています。再度ログインしてください。');

    // 【バグ9修正】授業時間中の場合、何故ダメなのかをクライアントへ通知してフリーズを防ぐ
    if (isCurrentlyClassTime) {
      return socket.emit('auth-error', '現在は授業時間中のため、新しく部屋を作成することはできません。');
    }
    const roomId = Math.random().toString(36).substring(7);
    rooms[roomId] = { name: name || `${socket.nickname}の部屋`, board: Array(64).fill(null), turn: 'X', players: [{ id: socket.id, userId: socket.userId, nickname: socket.nickname, icon: socket.icon, role: 'X' }], winner: null, rematchVotes: [], disconnectTimers: {}, isClassPaused: false };
    socket.join(roomId);
    socket.emit('joined-room', { roomId, role: 'X', board: rooms[roomId].board, turn: 'X', players: rooms[roomId].players });
    broadcastState();
  });

  // 部屋参加
  socket.on('join-room', (roomId) => {
    // 【修正】undefined名のバグ防止
    if (!socket.nickname || !socket.userId) return socket.emit('auth-error', 'セッションが切れています。再度ログインしてください。');

    // 【バグ9修正】授業時間中の場合、何故ダメなのかをクライアントへ通知してフリーズを防ぐ
    if (isCurrentlyClassTime) {
      return socket.emit('auth-error', '現在は授業時間中のため、部屋に参加することはできません。');
    }
    const room = rooms[roomId];
    if (!room) return;

    // 【新規追加・修正】自分と対戦できるバグ（多重ログイン・同一ブラウザでの参加）を完全にブロック
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
    // 【修正】undefinedバグ等の防御壁
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

    // 【新規追加】試合終了後にプレイヤーが退出した場合、即座に部屋を解散する
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
      return; // 以降の処理をスキップ
    }

    // 【バグ1修正】授業中の一時停止期間にプレイヤーが能動的に退出した場合、残された対戦相手のフリーズを防ぐため即座に部屋を解散する
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
      return; // 以降の処理をスキップ
    }

    if (p && p.role !== 'Spectator' && !room.winner && !room.isClassPaused && !isCurrentlyClassTime && activeCount === 2) {
      const op = room.players.find(pl => pl.role !== 'Spectator' && pl.id !== socket.id);

      if (op && room.disconnectTimers && room.disconnectTimers[op.userId]) {
        await executeDefaultWin(roomId, op.userId);
      } else {
        await executeDefaultWin(roomId, socket.userId);
      }
    }

    // クリーンアップ
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

        // 【新規追加】試合終了後に対戦プレイヤーが切断した場合も、即座に部屋を解散する
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
          broadcastState(); // 非同期だがdisconnectブロックの最後なのでそのまま呼び出し
          return; // 以降の処理をスキップ
        }

        // 【バグ7修正】対戦プレイヤーが切断、かつ部屋にアクティブなプレイヤーが「2人」揃っている時のみタイマー起動
        if (p.role !== 'Spectator' && !room.winner && activeCount === 2) {
          if (room.isClassPaused || isCurrentlyClassTime) return;

          io.to(roomId).emit('game-paused', { reason: 'disconnect', message: '対戦相手の通信が切断されました。復帰を待っています...(60秒後に不戦勝)' });

          // 【バグ5修正】既存の重複タイマーがあれば必ずクリアしてリークを防ぐ
          if (room.disconnectTimers && room.disconnectTimers[p.userId]) {
            clearTimeout(room.disconnectTimers[p.userId]);
          }

          room.disconnectTimers = room.disconnectTimers || {};
          room.disconnectTimers[p.userId] = setTimeout(() => {
            executeDefaultWin(roomId, p.userId).catch(console.error);
          }, 60000);
        } else {
          // 観戦者、試合終了後、あるいは1人しかいない部屋の場合は即座にクリーンアップ
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

  // ==========================================
  // 【新規追加】運営・管理者専用 Socketイベント
  // ==========================================

  // 1. 全ユーザーアカウント一覧の取得
  socket.on('admin-get-users', async (secretKey) => {
    if (secretKey !== ADMIN_SECRET) {
      return socket.emit('admin-error', 'シークレットキーが正しくありません。認証に失敗しました。');
    }
    try {
      // 運営用なのでパスワード以外の全データを取得
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

      // データベースからユーザーを完全に削除
      await User.deleteOne({ userId: targetUserId });
      console.log(`[ADMIN] User ${targetUser.nickname} (${targetUserId}) was deleted.`);

      // 削除が完了したら、現在の最新リストを再取得して管理画面に送り返す
      const allUsers = await User.find({}).select('-password').sort({ nickname: 1 });
      socket.emit('admin-users-list', allUsers);

      // ランキングやロビーの部屋リストも最新状態に更新
      await broadcastState();
    } catch (err) {
      console.error('Admin Delete Error:', err);
      socket.emit('admin-error', 'ユーザーの削除中にサーバーエラーが発生しました。');
    }
  });

});

server.listen(3000, () => console.log('Server is running on port 3000'));