const express = require('express');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const MONGO_URI = process.env.MONGO_URI;

const slotSchema = new mongoose.Schema({
  day: String,
  time: String,
  maxTickets: { type: Number, default: 20 },
  issued: { type: Number, default: 0 },
  called: { type: Number, default: 0 },
  calledNoTicket: { type: Number, default: 0 }
});

const Slot = mongoose.model('ClassBSlot', slotSchema);

async function initSlots() {
  const count = await Slot.countDocuments();
  if (count === 0) {
    const defaultSlots = [];
    const day1Times = ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30'];
    day1Times.forEach(t => defaultSlots.push({ day: 'Day 1', time: t, maxTickets: 20 }));

    const day2Times = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'];
    day2Times.forEach(t => defaultSlots.push({ day: 'Day 2', time: t, maxTickets: 20 }));

    await Slot.insertMany(defaultSlots);
    console.log('SYSTEM: DATABASE INITIALIZED');
  }
}

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB Connected');
    initSlots();
  })
  .catch(err => console.log('MongoDB Connection Error:', err));

app.get('/api/slots', async (req, res) => {
  const slots = await Slot.find().sort({ day: 1, time: 1 });
  res.json(slots);
});

app.post('/api/update-count', async (req, res) => {
  const { day, time, type, change } = req.body;

  // ★対策1：連打されても確実に取りこぼさない「アトミック更新($inc)」を使用
  let updateQuery = {};
  if (type === 'issued') updateQuery = { $inc: { issued: change } };
  else if (type === 'called') updateQuery = { $inc: { called: change } };
  else if (type === 'calledNoTicket') updateQuery = { $inc: { calledNoTicket: change } };

  // まず確実に足し算・引き算を実行する
  let slot = await Slot.findOneAndUpdate(
    { day, time },
    updateQuery,
    { new: true }
  );

  if (!slot) return res.status(404).json({ error: 'Not found' });

  // ★対策2：足しすぎたり引きすぎた場合（0〜20の範囲外）は、安全な数値に補正する
  let needsFix = false;
  if (slot.issued < 0) { slot.issued = 0; needsFix = true; }
  if (slot.issued > slot.maxTickets) { slot.issued = slot.maxTickets; needsFix = true; }

  if (slot.called < 0) { slot.called = 0; needsFix = true; }
  if (slot.called > slot.issued) { slot.called = slot.issued; needsFix = true; }

  if (slot.calledNoTicket < 0) { slot.calledNoTicket = 0; needsFix = true; }
  if (slot.calledNoTicket > 20) { slot.calledNoTicket = 20; needsFix = true; }

  // 補正があった場合のみ保存し直す
  if (needsFix) {
    await slot.save();
  }

  res.json({ success: true, issued: slot.issued, called: slot.called, calledNoTicket: slot.calledNoTicket });
});

app.post('/api/hard-reset', async (req, res) => {
  await Slot.deleteMany({});
  await initSlots();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});