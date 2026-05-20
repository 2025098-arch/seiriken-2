const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose'); // 拡張：MongoDB用ORMの導入

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// 🚀 MongoDB Atlasへの接続設定 (環境変数 MONGO_URI から安全に読み込み)
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB successfully.'))
  .catch(err => console.error('MongoDB connection error:', err));

// 🚀 既存のJSONデータ構造を完全に維持したMongooseスキーマ定義
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  nickname: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  icon: { type: mongoose.Schema.Types.Mixed }, // アバターのパーツ構成オブジェクトもそのまま保存可能
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

// 日本時間の授業時間判定 (ロジック・祝日リスト完全ノーカット)
function checkClassTime() {
  const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
  const day = now.getDay();
  if (day === 0) return false; 
  const mmdd = String(now.getMonth()+1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

  // 祝日リスト (2024~2026目安)
  const holidays = ["01-01", "01-08", "01-12", "02-11", "02-23", "03-20", "04-29", "05-03", "05-04", "05-05", "05-06", "07-15", "07-20", "08-11", "08-12", "09-16", "09-21", "09-22", "09-23", "10-12", "10-14", "11-03", "11-04", "11-23"];
  if (holidays.includes(mmdd)) return false;

  const mins = now.getHours() * 60 + now.getMinutes();
  const p1 = mins >= 8*60+50 && mins < 9*60+40;
  const p2 = mins >= 9*60+50 && mins < 10*60+40;
  const p3 = mins >= 10*60+50 && mins < 11*60+40;
  const p4 = mins >= 12*60+45 && mins < 13*60+35;
  const p5 = mins >= 13*60+45 && mins < 14*60+35;
  const p6 = mins >= 14*60+45 && mins < 15*60+35;

  if (day === 6) return p1 || p2 || p3; // 土曜
  return p1 || p2 || p3 || p4 || p5 || p6; // 平日
}

let isCurrentlyClassTime = false;
setInterval(() => {
  const current = checkClassTime();
  if (current !== isCurrentlyClassTime) {
    isCurrentlyClassTime = current;
    io.emit('schedule-status', isCurrentlyClassTime);
  }
}, 10000);

// 立体4目並べの勝利ライン定義（全76ライン完全ノーカット）
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

// 🚀 MongoDBから全ユーザーデータを取得してリーダーボードをブロードキャストするよう非同期化
async function broadcastState() {
  try {
    const allUsers = await User.find({});
    io.emit('room-list', Object.keys(rooms).map(id => ({ 
      id, 
      name: rooms[id].name, 
      playerCount: rooms[id].players.filter(p => p.role !== 'Spectator').length, 
      winner: rooms[id].winner 
    })));
    io.emit('leaderboard-update', allUsers);
  } catch (err) {
    console.error('Error in broadcastState:', err);
  }
}

// 🚀 不戦勝・不戦敗の完全記録 ＆ ルームの強制自動消滅ロジック (MongoDB用に完全非同期化)
async function executeDefaultWin(roomId, leaverUserId) {
  const room = rooms[roomId];
  if (!room || room.winner) return;

  // 【🔥今回の修正箇所：ここから🔥】
  // アクティブなプレイヤー（XかO）が2人未満、つまり「まだ対戦相手が来ていない」なら不戦敗処理を中止する
  const activePlayers = room.players.filter(p => p.role === 'X' || p.role === 'O');
  if (activePlayers.length < 2) return;
  // 【🔥今回の修正箇所：ここまで🔥】

  const leavingPlayer = room.players.find(p => p.userId === leaverUserId);
  const leavingPlayerRole = leavingPlayer?.role;
  if (!leavingPlayerRole || leavingPlayerRole === 'Spectator') return;

  const opponentRole = leavingPlayerRole === 'X' ? 'O' : 'X';
  const remainingOpponent = room.players.find(p => p.role === opponentRole);

  room.winner = opponentRole;

  try {
    // 切断したプレイヤーのスタッツをDBから検索して更新
    const leaverStats = await User.findOne({ userId: leaverUserId });
    if (leaverStats) {
      leaverStats.defaultLosses += 1;
      leaverStats.totalLosses += 1;
      await leaverStats.save();
    }

    // 残された対戦相手のスタッツをDBから検索して更新
    if (remainingOpponent) {
      const opponentStats = await User.findOne({ userId: remainingOpponent.userId });
      if (opponentStats) {
        opponentStats.defaultWins += 1;
        opponentStats.totalWins += 1;
        await opponentStats.save();
        io.to(remainingOpponent.id).emit('sync-stats', opponentStats);
      }
    }

    // ルーム内の全員（観戦者含む）に不戦勝の発生を即時通知
    io.to(roomId).emit('win', { 
      winnerRole: opponentRole, 
      board: room.board, 
      players: room.players, 
      isDefault: true, 
      leaverName: leavingPlayer ? leavingPlayer.nickname : "対戦相手" 
    });

    await broadcastState();

    // 不戦勝が発生したら強制的にそのルームを無くし、全員を退出させる（猶予4秒）
    setTimeout(() => {
      if (rooms[roomId]) {
        io.to(roomId).emit('forced-leave', { message: '不戦勝・不戦敗が確定したため、この部屋は自動的に解散されました。' });

        const ioRoom = io.sockets.adapter.rooms.get(roomId);
        if (ioRoom) {
          const socketIds = Array.from(ioRoom);
          socketIds.forEach(id => {
            const s = io.sockets.sockets.get(id);
            if (s) s.leave(roomId);
          });
        }
        delete rooms[roomId];
        broadcastState();
      }
    }, 4000);

  } catch (err) {
    console.error('Error in executeDefaultWin:', err);
  }
}

io.on('connection', (socket) => {
  socket.emit('schedule-status', isCurrentlyClassTime); // 接続時に現在の授業状態を渡す

  // 🚀 アカウント登録 (MongoDB対応・重複チェック完全非同期化)
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

  // 🚀 ログイン (MongoDB対応・切断中/一時停止中の部屋への完全復帰処理)
  socket.on('login', async (data) => {
    try {
      const user = await User.findOne({ nickname: data.nickname });
      if (!user || user.password !== data.password) return socket.emit('auth-error', '名前かパスワードが間違っています。');

      socket.userId = user.userId; socket.nickname = user.nickname; socket.icon = user.icon;
      socket.emit('auth-success', user);

      // 切断中(一時停止中)の部屋があれば復帰
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
          io.to(roomId).emit('game-resumed');
          io.to(roomId).emit('update-players', room.players);
        }
      });
      await broadcastState();
    } catch (err) {
      console.error('Login error:', err);
      socket.emit('auth-error', 'サーバーエラーによりログインに失敗しました。');
    }
  });

  // 🚀 プロフィール更新 (MongoDB対応・ニックネーム変更時のユニーク制限完全担保)
  socket.on('update-profile', async (data) => {
    try {
      const user = await User.findOne({ nickname: socket.nickname });
      if (!user || user.password !== data.oldPassword) return socket.emit('auth-error', '現在のパスワードが違います。');

      if (data.newNickname !== socket.nickname) {
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

      // 現在いる部屋のプレイヤー情報も更新
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

  socket.on('chat-message', ({ roomId, message }) => {
    if (roomId && rooms[roomId]) {
      const p = rooms[roomId].players.find(pl => pl.id === socket.id);
      io.to(roomId).emit('chat-message', { nickname: socket.nickname, role: p ? (p.role==='Spectator'?'観戦':p.role) : '??', message });
    } else {
      io.emit('lobby-chat-message', { nickname: socket.nickname, message });
    }
  });

  socket.on('create-room', (name) => {
    if (isCurrentlyClassTime) return;
    const roomId = Math.random().toString(36).substring(7);
    rooms[roomId] = { name: name || `${socket.nickname}の部屋`, board: Array(64).fill(null), turn: 'X', players: [{ id: socket.id, userId: socket.userId, nickname: socket.nickname, icon: socket.icon, role: 'X' }], winner: null, rematchVotes: [], disconnectTimers: {} };
    socket.join(roomId);
    socket.emit('joined-room', { roomId, role: 'X', board: rooms[roomId].board, turn: 'X', players: rooms[roomId].players });
    broadcastState();
  });

  socket.on('join-room', (roomId) => {
    if (isCurrentlyClassTime) return;
    const room = rooms[roomId];
    if (!room) return;
    const current = room.players.filter(p => p.role !== 'Spectator');
    let role = 'Spectator';
    if (current.length < 2) role = current.length === 0 ? 'X' : (current[0].role === 'X' ? 'O' : 'X');
    room.players.push({ id: socket.id, userId: socket.userId, nickname: socket.nickname, icon: socket.icon, role });
    socket.join(roomId);
    io.to(roomId).emit('update-players', room.players);
    socket.emit('joined-room', { roomId, role, board: room.board, turn: room.turn, winner: room.winner, players: room.players });
    broadcastState();
  });

  // 🚀 コマの配置・通常勝利・引き分け判定 (MongoDB対応・スタッツ更新非同期化)
  socket.on('move', async ({ roomId, pegIndex }) => {
    const room = rooms[roomId];
    if (!room || room.winner || isCurrentlyClassTime) return;
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

          const winnerStats = await User.findOne({ userId: p.userId });
          if (winnerStats) { 
            winnerStats.wins++; winnerStats.totalWins++; 
            await winnerStats.save(); 
            io.to(p.id).emit('sync-stats', winnerStats); 
          }

          if (op) {
            const loserStats = await User.findOne({ userId: op.userId });
            if (loserStats) { 
              loserStats.losses++; loserStats.totalLosses++; 
              await loserStats.save(); 
              io.to(op.id).emit('sync-stats', loserStats); 
            }
          }

          io.to(roomId).emit('win', { winnerRole: p.role, board: room.board, players: room.players, isDefault: false });
          await broadcastState();
        } else if (checkDraw(room.board)) {
          room.winner = 'Draw';
          const activePlayers = room.players.filter(pl => pl.role !== 'Spectator');

          for (const pl of activePlayers) {
            const st = await User.findOne({ userId: pl.userId });
            if (st) { 
              st.totalDraws++; 
              await st.save(); 
              io.to(pl.id).emit('sync-stats', st); 
            }
          }

          io.to(roomId).emit('draw', { board: room.board, players: room.players });
          await broadcastState();
        } else {
          room.turn = room.turn === 'X' ? 'O' : 'X';
          io.to(roomId).emit('update', { board: room.board, turn: room.turn });
        }
      } catch (err) {
        console.error('Move processing error:', err);
      }
    }
  });

  socket.on('rematch', (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.winner || isCurrentlyClassTime) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (p && p.role !== 'Spectator' && !room.rematchVotes.includes(p.role)) {
      room.rematchVotes.push(p.role);
      if (room.rematchVotes.length === 2) {
        room.board = Array(64).fill(null); room.turn = 'X'; room.winner = null; room.rematchVotes = [];
        room.players.forEach(pl => { if (pl.role === 'X') pl.role = 'O'; else if (pl.role === 'O') pl.role = 'X'; });
        io.to(roomId).emit('rematch-start', { board: room.board, turn: room.turn, players: room.players });
        broadcastState();
      } else {
        io.to(roomId).emit('rematch-voted', p.role);
      }
    }
  });

  // 「意図的な退室」は即座に不戦敗処理へ
  socket.on('leave-room', (roomId) => {
    const room = rooms[roomId];
    if (room) {
      executeDefaultWin(roomId, socket.userId);
      room.players = room.players.filter(p => p.id !== socket.id);
      socket.leave(roomId);
      if (room.players.length === 0) delete rooms[roomId];
      else io.to(roomId).emit('update-players', room.players);
      broadcastState();
    }
  });

  // 「不意の通信切断」は60秒の一時停止猶予を与える
  socket.on('disconnect', () => {
    Object.keys(rooms).forEach(roomId => {
      const room = rooms[roomId];
      const p = room.players.find(pl => pl.id === socket.id);
      if (p) {
        if (p.role !== 'Spectator' && !room.winner) {
          io.to(roomId).emit('game-paused', { reason: 'disconnect', message: '対戦相手の通信が切断されました。復帰を待っています...(60秒後に不戦勝)' });
          room.disconnectTimers = room.disconnectTimers || {};
          room.disconnectTimers[p.userId] = setTimeout(() => {
            executeDefaultWin(roomId, p.userId);
            room.players = room.players.filter(pl => pl.userId !== p.userId);
            if (room.players.length === 0) delete rooms[roomId];
            else io.to(roomId).emit('update-players', room.players);
            broadcastState();
          }, 60000);
        } else {
          room.players = room.players.filter(pl => pl.id !== socket.id);
          if (room.players.length === 0) delete rooms[roomId];
          else io.to(roomId).emit('update-players', room.players);
        }
      }
    });
  });
});

server.listen(3000, () => console.log('Server is running on port 3000'));