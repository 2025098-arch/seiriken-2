const express = require('express');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const MONGO_URI = process.env.MONGO_URI;

// 時間枠ごとのデータスキーマ
const slotSchema = new mongoose.Schema({
  time: String,
  maxTickets: { type: Number, default: 5 },
  issued: { type: Number, default: 0 },
  called: { type: Number, default: 0 }
});
const Slot = mongoose.model('Slot', slotSchema);

// DBが空の場合、デフォルトの時間枠を作成する関数
async function initSlots() {
  const count = await Slot.countDocuments();
  if (count === 0) {
    const defaultSlots = [
      { time: '10:00', maxTickets: 10 },
      { time: '11:00', maxTickets: 15 },
      { time: '12:00', maxTickets: 10 }
    ];
    await Slot.insertMany(defaultSlots);
    console.log('初期データを作成しました');
  }
}

// ★データベースに接続してから初期化を実行するように修正
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB Connected');
    initSlots();
  })
  .catch(err => console.log('MongoDB Connection Error:', err));

// 全時間枠の状況を取得
app.get('/api/slots', async (req, res) => {
  const slots = await Slot.find().sort({ time: 1 });
  res.json(slots);
});

// 指定した時間枠で整理券を発行
app.post('/api/issue', async (req, res) => {
  const { time } = req.body;
  const slot = await Slot.findOne({ time });

  if (!slot) return res.status(404).json({ error: '時間枠が見つかりません' });
  if (slot.issued >= slot.maxTickets) return res.status(400).json({ error: 'この時間帯は定員に達しました' });

  slot.issued += 1;
  await slot.save();
  res.json({ success: true, ticketNumber: slot.issued, time: slot.time });
});

// 次の番号を呼び出し
app.post('/api/call', async (req, res) => {
  const { time } = req.body;
  const slot = await Slot.findOne({ time });

  if (slot && slot.called < slot.issued) {
    slot.called += 1;
    await slot.save();
  }
  res.json({ success: true });
});

// 全リセット
app.post('/api/reset', async (req, res) => {
  await Slot.updateMany({}, { $set: { issued: 0, called: 0 } });
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});