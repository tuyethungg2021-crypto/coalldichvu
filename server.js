require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { MongoClient } = require('mongodb');
const { v2: cloudinary } = require('cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'hungnbyt';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'azhung12';
const MONGODB_URI = String(process.env.MONGODB_URI || '').trim();
const MONGODB_DB = String(process.env.MONGODB_DB || 'coalldichvu').trim();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Route: Lịch Sử Admin theo API Key ---
app.get('/admin/history', async (req, res) => {
    try {
        const apiKey = req.query.apiKey; // admin nhập API Key
        if (!apiKey) return res.status(400).json({ error: 'apiKey required' });

        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        const db = client.db(MONGODB_DB);
        const collection = db.collection('history'); // collection lưu lịch sử

        // Query chỉ lấy dữ liệu của apiKey này
        const data = await collection.find({ apiKey }).sort({ createdAt: -1 }).toArray();

        await client.close();
        res.json({ success: true, data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- Các route khác của bạn vẫn giữ nguyên ---
// Ví dụ: login admin, thuê sim, nạp tiền, các API khác...

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
