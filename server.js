
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Route cũ giữ nguyên
app.get('/api/chaycodeso3', async (req, res) => {
    res.json({message: 'User API cũ giữ nguyên'});
});

// Route mới: lịch sử API Key
app.get('/api/chaycodeso3/history', async (req, res) => {
    const { key } = req.query;
    if(!key) return res.status(400).json({ error: 'Missing key' });
    try {
        const response = await fetch(`https://api.chaycodeso3.com/history?api_key=${key}`);
        const data = await response.json();
        const sorted = data.sort((a,b)=>new Date(b.time)-new Date(a.time));
        res.json(sorted);
    } catch(err) {
        console.error(err);
        res.status(500).json({ error: 'Cannot fetch history' });
    }
});

app.get('/', (req,res)=>{
    res.sendFile(path.join(__dirname,'public/index.html'));
});

app.listen(3000,()=>console.log('Server running on port 3000'));
